/**
 * Shader Evolver - LLM-powered shader mutation and evolution
 */

import Anthropic from '@anthropic-ai/sdk';
import { ShaderCompiler } from '../engine/ShaderCompiler';
import { ParameterManager } from '../engine/ParameterManager';
import { SessionMemory } from './SessionMemory';
import { PipelineBuilder } from '../engine/PipelineBuilder';
import { Executor } from '../engine/Executor';
import { ResultRenderer } from '../output/ResultRenderer';
import { BufferManager } from '../engine/BufferManager';
import { WebGPUContext } from '../engine/WebGPUContext';
import { CoordinateGenerator } from '../input/CoordinateGenerator';
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
}

export interface EvolutionResult {
  success: boolean;
  shader?: ShaderDefinition;
  error?: string;
  debugAttempts?: number;
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
  private resultRenderer: ResultRenderer;
  private coordGenerator: CoordinateGenerator;

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
    this.webgpuContext = webgpuContext;
    this.bufferManager = bufferManager;
    this.pipelineBuilder = new PipelineBuilder(webgpuContext);
    this.executor = new Executor(webgpuContext);
    this.resultRenderer = new ResultRenderer(bufferManager, webgpuContext);
    this.coordGenerator = new CoordinateGenerator();

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
    try {
      const device = this.webgpuContext.getDevice();
      const dimensions = { width: size, height: size };

      // Compile the shader
      const compileResult = await this.compiler.compile(shaderSource, 'visual-feedback', false);

      if (!compileResult.success || !compileResult.module) {
        const errorMsg = ShaderCompiler.formatErrors(compileResult.errors);
        throw new Error(`Shader compilation failed:\n${errorMsg}`);
      }

      // Parse parameters
      const parameters = this.parameterManager.parseParameters(shaderSource);

      // Create coordinate texture and sampler
      const coordTexture = await this.coordGenerator.createCoordinateTexture(
        dimensions,
        this.webgpuContext,
        1.0, // zoom
        0,   // panX
        0    // panY
      );
      const coordSampler = this.coordGenerator.createCoordinateSampler(this.webgpuContext);

      // Create output buffer (vec4<f32> = 16 bytes per pixel)
      const outputSize = size * size * 4 * 4;
      const outputBuffer = this.bufferManager.createBuffer(
        {
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          label: 'visual-feedback-output',
        },
        false
      );

      // Create dimensions buffer
      const dimensionsData = new Uint32Array([size, size, 0, 0]);
      const dimensionsBuffer = this.bufferManager.createBufferWithData(
        dimensionsData as BufferSource,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'visual-feedback-dims'
      );

      // Create parameter buffer if needed
      let paramBuffer: GPUBuffer | undefined;
      if (parameters.length > 0) {
        paramBuffer = this.parameterManager.createParameterBuffer(parameters);
      }

      // Build pipeline with unique label to avoid caching conflicts
      const hasParams = parameters.length > 0;
      const hasIterations = false; // Don't support feedback textures in preview
      const uniqueLabel = `visual-feedback-${crypto.randomUUID().slice(0, 8)}`;

      // Push GPU error scopes to catch validation errors
      device.pushErrorScope('validation');
      let errorScopePushed = true;

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
          coordTexture,
          coordSampler,
          outputBuffer,
          dimensionsBuffer,
          paramBuffer
        );

        // Execute shader
        const workgroups = this.executor.calculateWorkgroups(size, size);
        const createExecutionContext = (pipeline: GPUComputePipeline, bindGroup: GPUBindGroup, workgroups: any, outputBuffer: GPUBuffer) => ({
          pipeline,
          bindGroup,
          workgroups,
          outputBuffer,
        });

        const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
        await this.executor.execute(executionContext);

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

      // Convert output buffer to base64 PNG
      const dataURL = await this.resultRenderer.bufferToDataURL(
        outputBuffer,
        dimensions,
        'image/png',
        0.7 // Lower quality to reduce size
      );

      // Extract base64 data (remove "data:image/png;base64," prefix)
      const base64Data = dataURL.split(',')[1];

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

          results.push({
            success: true,
            shader: childShader,
          });

          console.log(`Child ${i + 1} generated successfully. Memory now has ${this.memory.getEntryCount()} entries.`);
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during evolution',
          });
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

          results.push({
            success: true,
            shader: mashupShaderDef,
          });

          console.log(`Mashup ${i + 1} generated successfully. Memory now has ${this.memory.getEntryCount()} entries.`);
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during mashup',
          });
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
    const prompt = createMashupPrompt(promptParams);

    // Add memory context to the prompt
    const memorySummary = this.memory.getMemorySummary(10);
    const fullPrompt = `${prompt}\n\n${memorySummary}`;

    console.log(`Batch mashup with ${model}, params ${JSON.stringify({ count: promptParams.count, temperature: promptParams.temperature })}, memory entries: ${this.memory.getEntryCount()}`);

    // Render all parent shaders to images for visual feedback
    console.log(`Rendering ${promptParams.shaders.length} parent shaders for visual feedback...`);
    const contentBlocks: Anthropic.MessageParam['content'] = [];

    // Render each parent shader
    for (let i = 0; i < promptParams.shaders.length; i++) {
      const shader = promptParams.shaders[i];
      const imageBase64 = await this.renderShaderToBase64(shader.source, 256);

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
      text: fullPrompt,
    });

    // Create messages array for conversation
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: contentBlocks,
      },
    ];

    // Loop to handle tool calls (including render_shader for experimentation)
    let renderCount = 0;
    const maxRenders = 4; // Limit iterations to prevent infinite loops

    while (true) {
      const startTime = performance.now();
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 16384, // Increased for multiple shaders
        temperature: promptParams.temperature,
        tools: [renderShaderTool, shaderObjectTool],
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Batch mashup call:`, {
        model: model,
        temperature: promptParams.temperature,
        count: promptParams.count,
        parent_count: promptParams.shaders.length,
        elapsed_ms: elapsed.toFixed(0),
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        total_tokens: message.usage.input_tokens + message.usage.output_tokens,
        stop_reason: message.stop_reason,
      });

      // Check if the model used the tool
      if (message.stop_reason === 'tool_use') {
        // Check for render_shader tool use (experimentation)
        const renderToolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'render_shader'
        );

        if (renderToolUse) {
          if (renderCount >= maxRenders) {
            console.warn(`Max render iterations (${maxRenders}) reached, forcing final output`);
            // Need to provide a tool_result for the tool_use, then ask for final output
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
                  content: `You've reached the maximum number of experimental renders (${maxRenders}). Please now use the shader_output tool to provide your ${promptParams.count} final mashup variations based on what you've learned.`,
                },
              ],
            });
            continue;
          }

          renderCount++;
          const input = renderToolUse.input as { shader: string; notes?: string };
          console.log(`[LLM] Rendering experimental mashup ${renderCount}/${maxRenders}${input.notes ? `: ${input.notes}` : ''}`);

          // Render the shader
          const renderResult = await this.renderShaderToBase64WithErrors(input.shader, 256);

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
              text: 'Above is the rendered output of your experimental mashup shader.',
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
          continue; // Continue the loop to get next message
        }

        // Check for shader_output tool use (final output)
        const outputToolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'shader_output'
        );

        if (outputToolUse) {
          console.log(`Success: extracting ${promptParams.count} final mashup shaders after ${renderCount} experimental renders`);
          const input = outputToolUse.input as { shaders: Array<{ name?: string; shader: string, changelog?: string }> };
          console.log(`Mashup shaders: ${input.shaders.length} generated`);
          return input.shaders;
        }
      }

      // If we get here without finding the tool use, something went wrong
      throw new Error(`Unexpected stop reason: ${message.stop_reason}`);
    }
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

    const prompt = createBatchMutationPrompt(promptParams);

    // Add memory context to the prompt
    const memorySummary = this.memory.getMemorySummary(10);
    const fullPrompt = `${prompt}\n\n${memorySummary}`;

    console.log(`Batch mutating with ${model}, params ${JSON.stringify(promptParams)}, memory entries: ${this.memory.getEntryCount()}`);

    // Render parent shader to image for visual feedback
    console.log('Rendering parent shader for visual feedback...');
    const parentImageBase64 = await this.renderShaderToBase64(shaderSource, 256);

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
      text: fullPrompt,
    });

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: contentBlocks,
      },
    ];

    // Loop to handle tool calls (including render_shader for experimentation)
    let renderCount = 0;
    const maxRenders = 4; // Limit iterations to prevent infinite loops

    while (true) {
      const startTime = performance.now();
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 16384, // Increased for multiple shaders
        temperature,
        tools: [renderShaderTool, shaderObjectTool],
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Batch mutation call:`, {
        model: model,
        temperature,
        count,
        elapsed_ms: elapsed.toFixed(0),
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        total_tokens: message.usage.input_tokens + message.usage.output_tokens,
        stop_reason: message.stop_reason,
      });

      // console.log(`Got response with stop_reason: ${message.stop_reason}`);

      // Check if the model used the tool
      if (message.stop_reason === 'tool_use') {
        // Check for render_shader tool use (experimentation)
        const renderToolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'render_shader'
        );

        if (renderToolUse) {
          if (renderCount >= maxRenders) {
            console.warn(`Max render iterations (${maxRenders}) reached, forcing final output`);
            // Need to provide a tool_result for the tool_use, then ask for final output
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
                  content: `You've reached the maximum number of experimental renders (${maxRenders}). Please now use the shader_output tool to provide your ${count} final variations based on what you've learned.`,
                },
              ],
            });
            continue;
          }

          renderCount++;
          const input = renderToolUse.input as { shader: string; notes?: string };
          console.log(`[LLM] Rendering experimental shader ${renderCount}/${maxRenders}${input.notes ? `: ${input.notes}` : ''}`);

          // Render the shader
          const renderResult = await this.renderShaderToBase64WithErrors(input.shader, 256);

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
              text: 'Above is the rendered output of your experimental shader.',
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
          continue; // Continue the loop to get next message
        }

        // Check for shader_output tool use (final output)
        const outputToolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'shader_output'
        );

        if (outputToolUse) {
          console.log(`Success: extracting ${count} final shaders after ${renderCount} experimental renders`);
          const input = outputToolUse.input as { shaders: Array<{ shader: string, changelog?: string }> };
          return input.shaders;
        }
      }

      // If we get here without finding the tool use, something went wrong
      throw new Error(`Unexpected stop reason: ${message.stop_reason}`);
    }
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

    const prompt = createDebugPrompt(promptParams);
    console.log(`Debug attempt ${attempt}, asking LLM to fix errors`);

    // Create messages array for conversation
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: prompt,
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
