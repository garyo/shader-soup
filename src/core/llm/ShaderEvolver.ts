/**
 * Shader Evolver - LLM-powered shader mutation and evolution
 */

import Anthropic from '@anthropic-ai/sdk';
import { ShaderCompiler } from '../engine/ShaderCompiler';
import { ParameterManager } from '../engine/ParameterManager';
import { SessionMemory } from './SessionMemory';
import { PipelineBuilder } from '../engine/PipelineBuilder';
import { Executor } from '../engine/Executor';
import { BufferManager } from '../engine/BufferManager';
import { WebGPUContext } from '../engine/WebGPUContext';
import { GPUPostProcessor } from '../engine/GPUPostProcessor';
// CoordinateGenerator and ResultRenderer no longer needed - using GPU-only CanvasRenderer path
import type { ShaderDefinition, ShaderParameter } from '@/types/core';
import {
  createBatchMutationPrompt,
  createDebugPrompt,
  createParameterNamingPrompt,
  createMashupPrompt,
  shaderObjectTool,
  debugShaderTool,
  parameterNamesTool,
  renderShaderTool,
  type BatchMutationPromptParams,
  type DebugPromptParams,
  type ParameterNamingPromptParams,
  type MashupPromptParams,
} from './prompts';

export interface EvolutionOptions {
  temperature?: number;
  maxDebugAttempts?: number;
  model?: string;
  batchSize?: number;
  onProgress?: (update: ProgressUpdate) => void;
  onChildCompleted?: (child: EvolutionResult, index: number, total: number) => void | Promise<void>;
  experimentsPerChild?: number;
  mashupExperiments?: number;
}

export interface ProgressUpdate {
  type: 'child' | 'experiment' | 'debug';
  currentChild?: number;
  totalChildren?: number;
  currentExperiment?: number;
  maxExperiments?: number;
  debugAttempt?: number;
  maxDebugAttempts?: number;
}

export interface EvolutionResult {
  success: boolean;
  shader?: ShaderDefinition;
  error?: string;
  debugAttempts?: number;
}

/**
 * Configuration for tool conversation loop
 */
interface ToolConversationConfig {
  operationType: 'mutation' | 'mashup';
  count: number;
  maxRenders: number;
  temperature: number;
  logPrefix: string; // e.g., "Batch mutation" or "Batch mashup"
}

export class ShaderEvolver {
  private anthropic: Anthropic;
  private compiler: ShaderCompiler;
  private parameterManager: ParameterManager;
  private memory: SessionMemory;
  private maxDebugAttempts: number;
  private webgpuContext: WebGPUContext;
  private bufferManager: BufferManager;
  private pipelineBuilder: PipelineBuilder;
  private executor: Executor;
  private gpuPostProcessor: GPUPostProcessor;
  // CoordinateGenerator and ResultRenderer removed - using GPU-only CanvasRenderer path
  private onProgress?: (update: ProgressUpdate) => void;
  private onChildCompleted?: (child: EvolutionResult, index: number, total: number) => void | Promise<void>;
  private experimentsPerChild: number;
  private mashupExperiments: number;

  constructor(
    apiKey: string,
    compiler: ShaderCompiler,
    parameterManager: ParameterManager,
    webgpuContext: WebGPUContext,
    bufferManager: BufferManager,
    options?: EvolutionOptions
  ) {
    this.anthropic = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true, // Note: In production, use backend proxy
    });
    this.compiler = compiler;
    this.parameterManager = parameterManager;
    this.memory = new SessionMemory();
    this.maxDebugAttempts = options?.maxDebugAttempts ?? 5;
    this.onProgress = options?.onProgress;
    this.onChildCompleted = options?.onChildCompleted;
    this.experimentsPerChild = options?.experimentsPerChild ?? 3;
    this.mashupExperiments = options?.mashupExperiments ?? 3;
    this.webgpuContext = webgpuContext;
    this.bufferManager = bufferManager;
    this.pipelineBuilder = new PipelineBuilder(webgpuContext);
    this.executor = new Executor(webgpuContext);
    this.gpuPostProcessor = new GPUPostProcessor(webgpuContext, compiler, bufferManager);
    // CoordinateGenerator and ResultRenderer removed - using GPU-only CanvasRenderer path

    console.log(`ShaderEvolver initialized with ${this.memory.getEntryCount()} memory entries`);
  }

  /**
   * Get access to the session memory (for UI controls if needed)
   */
  public getMemory(): SessionMemory {
    return this.memory;
  }

  /**
   * Render a shader to a base64-encoded image with error reporting
   * @param shaderSource - WGSL shader source code
   * @param size - Image size (default 256x256)
   * @returns Result object with success flag, image data, or error message
   */
  private async renderShaderToBase64WithErrors(
    shaderSource: string,
    size: number = 256
  ): Promise<{ success: boolean; imageBase64?: string; error?: string }> {
    try {
      const result = await this.renderShaderToBase64(shaderSource, size);
      if (result) {
        return { success: true, imageBase64: result };
      } else {
        return { success: false, error: 'Failed to render shader (unknown error)' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Render a shader to a base64-encoded image for visual feedback
   * @param shaderSource - WGSL shader source code
   * @param size - Image size (default 256x256)
   * @returns Base64-encoded PNG image data (without data URL prefix), or empty string on error
   */
  private async renderShaderToBase64(
    shaderSource: string,
    size: number = 256
  ): Promise<string> {
    const totalStart = performance.now();
    try {
      const device = this.webgpuContext.getDevice();

      // Compile the shader
      const compileStart = performance.now();
      const compileResult = await this.compiler.compile(shaderSource, 'visual-feedback', false);
      const compileTime = performance.now() - compileStart;

      if (!compileResult.success || !compileResult.module) {
        const errorMsg = ShaderCompiler.formatErrors(compileResult.errors);
        throw new Error(`Shader compilation failed:\n${errorMsg}`);
      }

      // Parse parameters and detect bindings
      const parameters = this.parameterManager.parseParameters(shaderSource);
      const bindingDetection = this.compiler.detectOptionalBindings(shaderSource);

      // Create output texture (HDR-capable)
      const outputTexture = device.createTexture({
        size: { width: size, height: size },
        format: this.webgpuContext.getStorageFormat() as GPUTextureFormat,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
        label: 'visual-feedback-output',
      });

      // Create dimensions buffer with zoom and pan
      // Struct layout: { width: u32, height: u32, zoom: f32, _pad1: u32, panX: f32, panY: f32, _pad2: u32, _pad3: u32 }
      const dimensionsData = new ArrayBuffer(32); // 8 × 4 bytes
      const u32View = new Uint32Array(dimensionsData);
      const f32View = new Float32Array(dimensionsData);

      u32View[0] = size;     // width: u32
      u32View[1] = size;     // height: u32
      f32View[2] = 1.0;      // zoom: f32
      u32View[3] = 0;        // _pad1: u32
      f32View[4] = 0.0;      // panX: f32
      f32View[5] = 0.0;      // panY: f32
      u32View[6] = 0;        // _pad2: u32
      u32View[7] = 0;        // _pad3: u32

      const dimensionsBuffer = this.bufferManager.createBufferWithData(
        dimensionsData,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'visual-feedback-dims'
      );

      // Create parameter buffer if needed (using binding detection, not just parsed params)
      let paramBuffer: GPUBuffer | undefined;
      const hasParamComments = parameters.length > 0;

      if (bindingDetection.hasParamsBinding) {
        if (hasParamComments) {
          // Normal case: shader has @param comments, use those values
          paramBuffer = this.parameterManager.createParameterBuffer(parameters);
        } else {
          // Mismatch case: shader declares @binding(2) but no @param comments
          console.warn(`[Visual Feedback] Shader declares @binding(2) but has no // @param comments. Creating dummy params buffer.`);
          // Create a larger dummy buffer to handle typical Params structs
          // WebGPU requires uniform buffers to be multiples of 16 bytes
          // Using 256 bytes should cover most cases (16 float parameters)
          paramBuffer = this.bufferManager.createBuffer(
            {
              size: 256,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
              label: 'visual-feedback-dummy-params',
            },
            false
          );
        }
      } else if (hasParamComments) {
        console.warn(`[Visual Feedback] Shader has // @param comments but no @binding(2) declaration. Parameters will be ignored.`);
      }

      // Build pipeline with unique label to avoid caching conflicts
      const hasParams = bindingDetection.hasParamsBinding; // Use actual binding detection
      const hasIterations = false; // Don't support feedback textures in preview
      const uniqueLabel = `visual-feedback-${crypto.randomUUID().slice(0, 8)}`;

      // Push GPU error scopes to catch validation errors
      device.pushErrorScope('validation');
      let errorScopePushed = true;
      let execTime = 0;

      try {
        const layout = this.pipelineBuilder.createStandardLayout(hasParams, hasIterations, uniqueLabel);

        const pipeline = this.pipelineBuilder.createPipeline({
          shader: compileResult.module,
          entryPoint: 'main',
          bindGroupLayouts: [layout],
          label: uniqueLabel,
        }, false); // Don't cache - each experimental shader is different

        // Create bind group
        const bindGroup = this.pipelineBuilder.createStandardBindGroup(
          layout,
          outputTexture,
          dimensionsBuffer,
          paramBuffer
        );

        // Execute shader
        const execStart = performance.now();
        const workgroups = this.executor.calculateWorkgroups(size, size);

        const executionContext = { pipeline, bindGroup, workgroups, outputBuffer: outputTexture };
        await this.executor.execute(executionContext);
        execTime = performance.now() - execStart;

        // Check for GPU validation errors
        const validationError = await device.popErrorScope();
        errorScopePushed = false; // Mark as popped
        if (validationError) {
          throw new Error(`GPU validation error: ${validationError.message}`);
        }
      } catch (error) {
        // Pop error scope only if it hasn't been popped yet
        if (errorScopePushed) {
          try {
            await device.popErrorScope();
          } catch (popError) {
            // Ignore errors when popping (might already be popped)
          }
        }
        throw error;
      }

      // 🚀 NEW GPU-ONLY PATH: Render texture directly to canvas, then to base64
      const encodeStart = performance.now();

      // Use GPUPostProcessor to convert rgba32float → rgba16float (same as main display path)
      // gamma=1.0, contrast=1.0 means no color adjustment, just format conversion
      const { displayTexture } = await this.gpuPostProcessor.applyGammaContrast(
        'thumbnail', // shaderId for texture pooling
        outputTexture,
        { width: size, height: size },
        1.0, // gamma (1.0 = no change)
        1.0  // contrast (1.0 = no change)
      );

      // Create offscreen canvas
      const canvas = new OffscreenCanvas(size, size);
      const canvasContext = canvas.getContext('webgpu');

      if (!canvasContext) {
        throw new Error('Failed to get WebGPU canvas context for thumbnail');
      }

      // Configure canvas for WebGPU rendering
      canvasContext.configure({
        device,
        format: 'rgba16float', // Match display format for HDR
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        alphaMode: 'opaque',
      });

      // Import CanvasRenderer dynamically to render GPU texture to canvas
      const { CanvasRenderer } = await import('../engine/CanvasRenderer');
      const canvasRenderer = new CanvasRenderer(this.webgpuContext);

      // Configure and render to offscreen canvas (use displayTexture, not outputTexture)
      canvasRenderer.configureCanvasContext(canvasContext as GPUCanvasContext);
      await canvasRenderer.renderToCanvas(displayTexture);

      // Convert canvas to base64 (all on GPU until this point!)
      const blob = await canvas.convertToBlob({ type: 'image/png', quality: 0.7 });
      const arrayBuffer = await blob.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const encodeTime = performance.now() - encodeStart;

      // base64Data is already extracted (no data URL prefix)

      const totalTime = performance.now() - totalStart;

      // Log timing breakdown if render is slow (>500ms)
      if (totalTime > 500) {
        console.warn(`[RENDER] Slow render detected (${totalTime.toFixed(1)}ms): compile=${compileTime.toFixed(1)}ms, exec=${execTime.toFixed(1)}ms, encode=${encodeTime.toFixed(1)}ms`);
      }

      return base64Data;
    } catch (error) {
      console.warn('Error rendering shader for visual feedback:', error);
      return ''; // Return empty string on error
    }
  }

  /**
   * Evolve multiple shader variations sequentially with memory
   * Sequential generation allows each shader to see what came before, improving creativity
   */
  public async evolveShaderBatch(
    parentShader: ShaderDefinition,
    count: number,
    temperature: number,
    model: string
  ): Promise<EvolutionResult[]> {
    try {
      console.log(`Generating ${count} children sequentially (with memory context)`);
      const results: EvolutionResult[] = [];

      // Generate shaders one at a time so each can see the previous ones
      for (let i = 0; i < count; i++) {
        try {
          console.log(`\n=== Generating child ${i + 1}/${count} ===`);

          // Report progress: starting child
          this.onProgress?.({
            type: 'child',
            currentChild: i + 1,
            totalChildren: count,
            currentExperiment: 0,
            maxExperiments: this.experimentsPerChild,
          });

          // Generate a single mutation with memory context
          const mutatedShaders = await this.batchMutateShader(
            parentShader.source,
            1, // Generate one at a time
            temperature,
            model
          );

          if (mutatedShaders.length === 0) {
            results.push({
              success: false,
              error: 'No shader generated',
            });
            continue;
          }

          const mutatedShader = mutatedShaders[0];
          const mutatedSource = mutatedShader.shader;
          const changelog = mutatedShader.changelog;

          // Debug until it compiles
          const debugResult = await this.debugShader(mutatedSource, model);

          if (!debugResult.success) {
            results.push({
              success: false,
              error: `Failed to compile after ${this.maxDebugAttempts} attempts`,
              debugAttempts: this.maxDebugAttempts,
            });
            continue;
          }

          // Parse parameters and iterations
          const parameters = this.parameterManager.parseParameters(debugResult.source);
          const iterations = this.parameterManager.parseIterations(debugResult.source);
          let namedParameters = parameters;
          const doParamRename = false;
          if (doParamRename) {
            // Update parameter names
            namedParameters = await this.updateParameterNames(debugResult.source, parameters, model);
          }

          // Create child shader with hierarchical naming
          const childNumber = i + 1;
          const uniqueSuffix = crypto.randomUUID().slice(0, 8);
          const childShader: ShaderDefinition = {
            id: crypto.randomUUID(),
            name: `${parentShader.name}.${childNumber}`, // Hierarchical name (e.g., "Sine Wave.1.3.2")
            cacheKey: `${parentShader.cacheKey}-${childNumber}-${uniqueSuffix}`, // Unique cache key
            source: debugResult.source,
            parameters: namedParameters,
            iterations: iterations,
            description: `Evolved from "${parentShader.name}"`,
            changelog: changelog,
            createdAt: new Date(),
            modifiedAt: new Date(),
          };

          // Add to memory IMMEDIATELY so the next shader can see it
          this.memory.addEntry({
            shaderSource: debugResult.source,
            changelog: changelog,
            type: 'mutation',
            parentInfo: `Evolution of "${parentShader.name}"`,
          });

          const result: EvolutionResult = {
            success: true,
            shader: childShader,
          };
          results.push(result);

          console.log(`Child ${i + 1} generated successfully. Memory now has ${this.memory.getEntryCount()} entries.`);

          // Call onChildCompleted callback for progressive display
          if (this.onChildCompleted) {
            await this.onChildCompleted(result, i, count);
          }
        } catch (error) {
          const result: EvolutionResult = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during evolution',
          };
          results.push(result);

          // Call onChildCompleted callback even for failures
          if (this.onChildCompleted) {
            await this.onChildCompleted(result, i, count);
          }
        }
      }

      return results;
    } catch (error) {
      // If batch fails entirely, return empty results
      console.error('Batch evolution failed:', error);
      return Array(count).fill({
        success: false,
        error: error instanceof Error ? error.message : 'Batch evolution failed',
      });
    }
  }


  // ==================== Tool Call Handling Helpers ====================

  /**
   * Find a specific tool use in a message
   */
  private findToolUse(message: Anthropic.Message, toolName: string): Anthropic.ToolUseBlock | undefined {
    return message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === toolName
    );
  }

  /**
   * Log LLM API call with timing and token usage
   */
  private logLLMCall(
    message: Anthropic.Message,
    elapsed: number,
    config: ToolConversationConfig,
    extraInfo?: Record<string, any>
  ): void {
    console.log(`[LLM] ${config.logPrefix} call:`, {
      model: message.model,
      temperature: config.temperature,
      count: config.count,
      elapsed_ms: elapsed.toFixed(0),
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      total_tokens: message.usage.input_tokens + message.usage.output_tokens,
      stop_reason: message.stop_reason,
      ...extraInfo,
    });
  }

  /**
   * Handle the case when max renders is reached - sends tool_result to force final output
   */
  private handleMaxRendersReached(
    messages: Anthropic.MessageParam[],
    message: Anthropic.Message,
    renderToolUse: Anthropic.ToolUseBlock,
    config: ToolConversationConfig
  ): void {
    console.warn(`Max render iterations (${config.maxRenders}) reached, forcing final output`);

    messages.push({
      role: 'assistant',
      content: message.content,
    });

    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: renderToolUse.id,
          content: `You've reached the maximum number of experimental renders (${config.maxRenders}). Please now use the shader_output tool to provide your ${config.count} final ${config.operationType === 'mashup' ? 'mashup ' : ''}variations. Choose the most visually interesting experiments you've seen so far, or refine them further if needed. If you found good results in your experiments, use those. Focus on visual interest and avoid boring or repetitive patterns.`,
        },
      ],
    });
  }

  /**
   * Handle a render_shader tool request - renders the shader and returns the result
   */
  private async handleRenderRequest(
    messages: Anthropic.MessageParam[],
    message: Anthropic.Message,
    renderToolUse: Anthropic.ToolUseBlock,
    renderCount: number,
    maxRenders: number,
    operationType: 'mutation' | 'mashup'
  ): Promise<void> {
    const input = renderToolUse.input as { shader: string; notes?: string };
    const typeLabel = operationType === 'mashup' ? 'mashup' : 'shader';
    console.log(`[LLM] Rendering experimental ${typeLabel} ${renderCount}/${maxRenders}${input.notes ? `: ${input.notes}` : ''}`);

    // Report progress: starting experiment
    this.onProgress?.({
      type: 'experiment',
      currentExperiment: renderCount,
      maxExperiments: maxRenders,
    });

    // Render the shader with timing (128x128 for speed)
    const renderStart = performance.now();
    const renderResult = await this.renderShaderToBase64WithErrors(input.shader, 128);
    const renderElapsed = performance.now() - renderStart;
    console.log(`[RENDER] Tool render completed in ${renderElapsed.toFixed(1)}ms (${renderResult.success ? 'success' : 'failed'})`);

    // Build tool result with image or error
    const toolResultContent: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

    if (renderResult.success && renderResult.imageBase64) {
      toolResultContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: renderResult.imageBase64,
        },
      });
      toolResultContent.push({
        type: 'text',
        text: `Above is the rendered output of your experimental ${typeLabel} shader.`,
      });
      console.log(`[LLM] Rendered image size: ${Math.round(renderResult.imageBase64.length / 1024)}KB`);
    } else {
      toolResultContent.push({
        type: 'text',
        text: `Failed to render shader:\n${renderResult.error}\n\nPlease fix these errors and try again.`,
      });
      console.log(`[LLM] Render failed: ${renderResult.error}`);
    }

    // Continue conversation with the render result
    messages.push({
      role: 'assistant',
      content: message.content,
    });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: renderToolUse.id,
          content: toolResultContent,
        },
      ],
    });
  }

  /**
   * Generic tool conversation loop handler
   * Handles render_shader tool for experimentation and shader_output for final results
   */
  private async handleToolConversation<T extends { shader: string; changelog?: string } | { name?: string; shader: string; changelog?: string }>(
    system: string,
    messages: Anthropic.MessageParam[],
    model: string,
    config: ToolConversationConfig
  ): Promise<T[]> {
    let renderCount = 0;

    while (true) {
      const startTime = performance.now();
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 16384,
        temperature: config.temperature,
        tools: [renderShaderTool,
          shaderObjectTool,
          {"type": "web_search_20250305", "name": "web_search", "max_uses": 1}],
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      this.logLLMCall(message, elapsed, config);

      // Check if the model used a tool
      if (message.stop_reason === 'tool_use') {
        // Check for render_shader tool use (experimentation)
        const renderToolUse = this.findToolUse(message, 'render_shader');

        if (renderToolUse) {
          if (renderCount >= config.maxRenders) {
            this.handleMaxRendersReached(messages, message, renderToolUse, config);
            continue;
          }

          renderCount++;
          await this.handleRenderRequest(messages, message, renderToolUse, renderCount, config.maxRenders, config.operationType);
          continue;
        }

        // Check for shader_output tool use (final output)
        const outputToolUse = this.findToolUse(message, 'shader_output');

        if (outputToolUse) {
          console.log(`Success: extracting ${config.count} final ${config.operationType === 'mashup' ? 'mashup ' : ''}shaders after ${renderCount} experimental renders`);
          const input = outputToolUse.input as { shaders: T[] };
          if (config.operationType === 'mashup') {
            console.log(`Mashup shaders: ${input.shaders.length} generated`);
          }
          return input.shaders;
        }
      }

      // If we get here without finding the tool use, something went wrong
      throw new Error(`Unexpected stop reason: ${message.stop_reason}`);
    }
  }

  // ==================== End Tool Call Handling Helpers ====================

  /**
   * Evolve mashup shaders sequentially with memory
   * Sequential generation allows each mashup to see what came before
   */
  public async evolveMashup(
    parentShaders: ShaderDefinition[],
    count: number,
    temperature: number,
    model: string
  ): Promise<EvolutionResult[]> {
    if (parentShaders.length < 2) {
      throw new Error('Mashup requires at least 2 parent shaders');
    }

    try {
      console.log(`Generating ${count} mashup variations sequentially (with memory context)`);
      const results: EvolutionResult[] = [];
      const parentNames = parentShaders.map(s => s.name).join(' + ');

      // Generate mashups one at a time so each can see the previous ones
      for (let i = 0; i < count; i++) {
        try {
          console.log(`\n=== Generating mashup ${i + 1}/${count} ===`);

          const promptParams: MashupPromptParams = {
            shaders: parentShaders.map(shader => ({
              name: shader.name,
              source: shader.source,
            })),
            count: 1, // Generate one at a time
            temperature: temperature,
          };

          const mashupShaders = await this.batchMashupShader(promptParams, model);

          if (mashupShaders.length === 0) {
            results.push({
              success: false,
              error: 'No mashup generated',
            });
            continue;
          }

          const mashupData = mashupShaders[0];
          const mashupSource = mashupData.shader;
          const changelog = mashupData.changelog;
          const llmName = mashupData.name;

          // Debug until it compiles
          const debugResult = await this.debugShader(mashupSource, model);

          if (!debugResult.success) {
            results.push({
              success: false,
              error: `Failed to compile after ${this.maxDebugAttempts} attempts`,
              debugAttempts: this.maxDebugAttempts,
            });
            continue;
          }

          // Parse parameters and iterations
          const parameters = this.parameterManager.parseParameters(debugResult.source);
          const iterations = this.parameterManager.parseIterations(debugResult.source);
          let namedParameters = parameters;
          const doParamRename = false;
          if (doParamRename) {
            // Update parameter names
            namedParameters = await this.updateParameterNames(debugResult.source, parameters, model);
          }

          // Create mashup shader with LLM-provided name or fallback
          const childNumber = i + 1;
          const uniqueSuffix = crypto.randomUUID().slice(0, 8);
          const mashupName = llmName || `Mashup ${childNumber}: ${parentNames}`;

          const mashupShaderDef: ShaderDefinition = {
            id: crypto.randomUUID(),
            name: mashupName,
            cacheKey: `mashup-${uniqueSuffix}`, // Unique cache key
            source: debugResult.source,
            parameters: namedParameters,
            iterations: iterations,
            description: `Mashup of: ${parentNames}`,
            changelog: changelog,
            createdAt: new Date(),
            modifiedAt: new Date(),
          };

          // Add to memory IMMEDIATELY so the next mashup can see it
          this.memory.addEntry({
            shaderSource: debugResult.source,
            changelog: changelog,
            type: 'mashup',
            parentInfo: `Mashup of: ${parentNames}`,
          });

          const result: EvolutionResult = {
            success: true,
            shader: mashupShaderDef,
          };
          results.push(result);

          console.log(`Mashup ${i + 1} generated successfully. Memory now has ${this.memory.getEntryCount()} entries.`);

          // Call onChildCompleted callback for progressive display (works for mashups too)
          if (this.onChildCompleted) {
            await this.onChildCompleted(result, i, count);
          }
        } catch (error) {
          const result: EvolutionResult = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during mashup',
          };
          results.push(result);

          // Call callback even for failures
          if (this.onChildCompleted) {
            await this.onChildCompleted(result, i, count);
          }
        }
      }

      return results;
    } catch (error) {
      // If mashup fails entirely, return empty results
      console.error('Mashup evolution failed:', error);
      return Array(count).fill({
        success: false,
        error: error instanceof Error ? error.message : 'Mashup evolution failed',
      });
    }
  }

  /**
   * Batch mashup shader - generate multiple mashup variations at once
   */
  private async batchMashupShader(
    promptParams: MashupPromptParams,
    model: string
  ): Promise<Array<{ name?: string; shader: string; changelog?: string }>> {
    const { system, user } = createMashupPrompt(promptParams);

    // Add memory context to the user prompt
    const memorySummary = this.memory.getMemorySummary(10);
    const fullUserPrompt = `${user}\n\n${memorySummary}`;

    console.log(`Batch mashup with ${model}, params ${JSON.stringify({ count: promptParams.count, temperature: promptParams.temperature })}, memory entries: ${this.memory.getEntryCount()}`);

    // Render all parent shaders to images for visual feedback
    console.log(`Rendering ${promptParams.shaders.length} parent shaders for visual feedback...`);
    const contentBlocks: Anthropic.MessageParam['content'] = [];

    // Render each parent shader (128x128 for speed)
    for (let i = 0; i < promptParams.shaders.length; i++) {
      const shader = promptParams.shaders[i];
      const imageBase64 = await this.renderShaderToBase64(shader.source, 128);

      if (imageBase64) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: imageBase64,
          },
        });
        contentBlocks.push({
          type: 'text',
          text: `Above: Visual output of parent shader "${shader.name}"`,
        });
        console.log(`Parent ${i + 1} "${shader.name}" image size: ${Math.round(imageBase64.length / 1024)}KB`);
      }
    }

    // Add the main prompt
    contentBlocks.push({
      type: 'text',
      text: fullUserPrompt,
    });

    // Create messages array for conversation
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: contentBlocks,
      },
    ];

    // Use common tool conversation handler
    return await this.handleToolConversation<{ name?: string; shader: string; changelog?: string }>(
      system,
      messages,
      model,
      {
        operationType: 'mashup',
        count: promptParams.count,
        maxRenders: this.mashupExperiments,
        temperature: promptParams.temperature,
        logPrefix: 'Batch mashup',
      }
    );
  }

  /**
   * Batch mutate shader - generate multiple variations at once
   */
  private async batchMutateShader(
    shaderSource: string,
    count: number,
    temperature: number,
    model: string
  ): Promise<Array<{ shader: string; changelog?: string }>> {
    const promptParams: BatchMutationPromptParams = {
      shaderSource,
      count,
      temperature,
      preserveParams: false,
    };

    const { system, user } = createBatchMutationPrompt(promptParams);

    // Add memory context to the user prompt
    const memorySummary = this.memory.getMemorySummary(10);
    const fullUserPrompt = `${user}\n\n${memorySummary}`;

    console.log(`Batch mutating with ${model}, memory entries: ${this.memory.getEntryCount()}`);

    // Render parent shader to image for visual feedback (128x128 for speed)
    console.log('Rendering parent shader for visual feedback...');
    const parentImageBase64 = await this.renderShaderToBase64(shaderSource, 128);

    // Create messages array for conversation with image
    const contentBlocks: Anthropic.MessageParam['content'] = [];

    // Add image if rendering succeeded
    if (parentImageBase64) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: parentImageBase64,
        },
      });
      contentBlocks.push({
        type: 'text',
        text: 'Above is the visual output of the parent shader you are mutating.',
      });
      console.log(`Visual feedback image size: ${Math.round(parentImageBase64.length / 1024)}KB`);
    }

    // Add the main prompt
    contentBlocks.push({
      type: 'text',
      text: fullUserPrompt,
    });

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: contentBlocks,
      },
    ];

    // Use common tool conversation handler
    return await this.handleToolConversation<{ shader: string; changelog?: string }>(
      system,
      messages,
      model,
      {
        operationType: 'mutation',
        count,
        maxRenders: this.experimentsPerChild,
        temperature,
        logPrefix: 'Batch mutation',
      }
    );
  }


  /**
   * Debug shader with compilation feedback loop
   * Now includes binding validation to catch runtime errors
   */
  private async debugShader(
    shaderSource: string,
    model: string
  ): Promise<{ success: boolean; source: string; attempts: number }> {
    let currentSource = shaderSource;
    let attempts = 0;

    while (attempts < this.maxDebugAttempts) {
      attempts++;

      // Try to compile
      const result = await this.compiler.compile(currentSource, `debug-attempt-${attempts}`);

      if (!result.success) {
        // Compilation failed - ask LLM to fix
        if (attempts < this.maxDebugAttempts) {
          const errorMessage = ShaderCompiler.formatErrors(result.errors);
          console.log(`Shader failed to compile on attempt ${attempts}; errs=${errorMessage}. Asking LLM to debug`)

          currentSource = await this.requestLLMFix(currentSource, errorMessage, attempts, model);
        }
        continue;
      }

      // Compilation succeeded - now validate by creating a GPU pipeline
      // Detect if shader has parameters by checking for Params struct
      const hasParams = currentSource.includes('struct Params');
      const hasInputTexture = currentSource.includes('prevFrame');

      const pipelineErrors = await this.compiler.validatePipeline(result.module!, hasParams, hasInputTexture);

      if (pipelineErrors.length === 0) {
        // All validation passed!
        return {
          success: true,
          source: currentSource,
          attempts,
        };
      }

      // Pipeline validation failed - ask LLM to fix
      if (attempts < this.maxDebugAttempts) {
        const errorMessage = `GPU validation errors:\n${pipelineErrors.join('\n')}`;
        console.log(`Shader has GPU validation errors on attempt ${attempts}; errs=${errorMessage}. Asking LLM to debug`);

        currentSource = await this.requestLLMFix(currentSource, errorMessage, attempts, model);
      }
    }

    // Failed after max attempts
    return {
      success: false,
      source: currentSource,
      attempts,
    };
  }

  /**
   * Request LLM to fix shader errors (compilation or binding validation)
   */
  private async requestLLMFix(
    shaderSource: string,
    errorMessage: string,
    attempt: number,
    model: string
  ): Promise<string> {
    const promptParams: DebugPromptParams = {
      shaderSource,
      errors: errorMessage,
      attempt,
    };

    const { system, user } = createDebugPrompt(promptParams);
    console.log(`Debug attempt ${attempt}, asking LLM to fix errors`);

    // Create messages array for conversation
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: user,
      },
    ];

    // Loop to handle tool calls
    while (true) {
      const startTime = performance.now();
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 8192,
        temperature: 0.3, // Lower temperature for debugging
        tools: [debugShaderTool],
        tool_choice: { type: "tool", name: "debug_shader_output" },
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Debug shader call (attempt ${attempt}):`, {
        model: model,
        temperature: 0.3,
        elapsed_ms: elapsed.toFixed(0),
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        total_tokens: message.usage.input_tokens + message.usage.output_tokens,
        stop_reason: message.stop_reason,
      });

      console.log(`Debug: got response with stop_reason: ${message.stop_reason}`);

      // Check if the model used the tool
      if (message.stop_reason === 'tool_use') {
        const toolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'debug_shader_output'
        );

        if (toolUse) {
          console.log(`Debug: tool used successfully, extracting fixed shader`);
          const input = toolUse.input as { shader: string };
          return input.shader;
        }
      }

      // If we get here without finding the tool use, something went wrong
      throw new Error(`Debug: unexpected stop reason: ${message.stop_reason}`);
    }
  }

  /**
   * Update parameter names based on shader analysis
   */
  private async updateParameterNames(
    shaderSource: string,
    parameters: ShaderParameter[],
    model: string
  ): Promise<ShaderParameter[]> {
    if (parameters.length === 0) {
      return parameters;
    }

    try {
      const promptParams: ParameterNamingPromptParams = {
        shaderSource,
        currentParams: parameters,
      };

      const prompt = createParameterNamingPrompt(promptParams);
      console.log(`Updating parameter names for ${parameters.length} parameters`);

      // Create messages array for conversation
      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      // Loop to handle tool calls
      let newNames: string[] = [];
      while (true) {
        const startTime = performance.now();
        const message = await this.anthropic.messages.create({
          model: model,
          max_tokens: 2048,
          temperature: 0.3,
          tools: [parameterNamesTool],
          tool_choice: { type: "tool", name: "parameter_names_output" },
          messages,
        });
        const elapsed = performance.now() - startTime;

        // Log timing and token usage
        console.log(`[LLM] Parameter naming call:`, {
          model: model,
          temperature: 0.3,
          param_count: parameters.length,
          elapsed_ms: elapsed.toFixed(0),
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          total_tokens: message.usage.input_tokens + message.usage.output_tokens,
          stop_reason: message.stop_reason,
        });

        console.log(`Parameter naming: got response with stop_reason: ${message.stop_reason}`);

        // Check if the model used the tool
        if (message.stop_reason === 'tool_use') {
          const toolUse = message.content.find(
            (block): block is Anthropic.ToolUseBlock =>
              block.type === 'tool_use' && block.name === 'parameter_names_output'
          );

          if (toolUse) {
            console.log(`Parameter naming: tool used successfully, extracting names`);
            const input = toolUse.input as { names: string[] };
            newNames = input.names;
            break;
          }
        }

        // If we get here without finding the tool use, something went wrong
        throw new Error(`Parameter naming: unexpected stop reason: ${message.stop_reason}`);
      }

      if (!Array.isArray(newNames) || newNames.length !== parameters.length) {
        console.warn('Invalid parameter names from LLM, keeping original names');
        return parameters;
      }

      // Update parameter names
      return parameters.map((param, index) => ({
        ...param,
        name: newNames[index] || param.name,
      }));
    } catch (error) {
      console.warn('Failed to update parameter names:', error);
      return parameters; // Return original parameters on error
    }
  }
}
