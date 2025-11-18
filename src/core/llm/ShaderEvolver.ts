/**
 * Shader Evolver - LLM-powered shader mutation and evolution
 */

import Anthropic from '@anthropic-ai/sdk';
import { ShaderCompiler } from '../engine/ShaderCompiler';
import { ParameterManager } from '../engine/ParameterManager';
import type { ShaderDefinition, ShaderParameter } from '@/types/core';
import {
  createBatchMutationPrompt,
  createDebugPrompt,
  createParameterNamingPrompt,
  createMashupPrompt,
  shaderObjectTool,
  debugShaderTool,
  parameterNamesTool,
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
  private maxDebugAttempts: number;
  private temperature: number;
  private model: string;
  private batchSize: number;

  constructor(
    apiKey: string,
    compiler: ShaderCompiler,
    parameterManager: ParameterManager,
    options?: EvolutionOptions
  ) {
    this.anthropic = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true, // Note: In production, use backend proxy
    });
    this.compiler = compiler;
    this.parameterManager = parameterManager;
    this.maxDebugAttempts = options?.maxDebugAttempts ?? 5;
    this.model = options?.model ?? 'claude-haiku-4-5'; // claude-haiku-4-5 or claude-haiku-4-5
    this.temperature = options?.temperature ?? 0.5; // TODO use defaultTemperature
    this.batchSize = options?.batchSize ?? 2; // Generate 2 shaders per API call for better performance
  }

  /**
   * Evolve multiple shader variations using parallel batch calls
   */
  public async evolveShaderBatch(
    parentShader: ShaderDefinition,
    count: number = 10,
    temperature?: number
  ): Promise<EvolutionResult[]> {
    // Use provided temperature or fall back to instance temperature
    const effectiveTemp = temperature ?? this.temperature;

    try {
      // Calculate number of parallel batches needed
      const numBatches = Math.ceil(count / this.batchSize);
      console.log(`Generating ${count} children in ${numBatches} parallel batches of ${this.batchSize}`);

      // Create array of batch promises
      const batchPromises: Promise<Array<{ shader: string; changelog?: string }>>[] = [];
      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const isLastBatch = batchIndex === numBatches - 1;
        const batchCount = isLastBatch ? count - (batchIndex * this.batchSize) : this.batchSize;
        batchPromises.push(this.batchMutateShader(parentShader.source, batchCount, effectiveTemp));
      }

      // Execute all batches in parallel
      const batchResults = await Promise.all(batchPromises);

      // Flatten results from all batches
      const mutatedShaders: Array<{ shader: string; changelog?: string }> = batchResults.flat();

      const results: EvolutionResult[] = [];

      // Process each mutated shader
      for (let i = 0; i < mutatedShaders.length; i++) {
        try {
          const mutatedShader = mutatedShaders[i];
          const mutatedSource = mutatedShader.shader;
          const changelog = mutatedShader.changelog;

          // Debug until it compiles
          const debugResult = await this.debugShader(mutatedSource);

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
            namedParameters = await this.updateParameterNames(debugResult.source, parameters);
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

          results.push({
            success: true,
            shader: childShader,
          });
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
   * Evolve mashup shaders - combine multiple shaders into new variations
   */
  public async evolveMashup(
    parentShaders: ShaderDefinition[],
    count: number = 6,
    temperature?: number
  ): Promise<EvolutionResult[]> {
    if (parentShaders.length < 2) {
      throw new Error('Mashup requires at least 2 parent shaders');
    }

    // Use provided temperature or fall back to instance temperature
    const effectiveTemp = temperature ?? this.temperature;

    try {
      console.log(`Generating ${count} mashup variations from ${parentShaders.length} parents`);

      // Create mashup prompt
      const promptParams: MashupPromptParams = {
        shaders: parentShaders.map(shader => ({
          name: shader.name,
          source: shader.source,
        })),
        count,
        temperature: effectiveTemp,
      };

      // Generate mashup shaders
      const mashupShaders = await this.batchMashupShader(promptParams);

      const results: EvolutionResult[] = [];

      // Process each mashup shader
      for (let i = 0; i < mashupShaders.length; i++) {
        try {
          const mashupData = mashupShaders[i];
          const mashupSource = mashupData.shader;
          const changelog = mashupData.changelog;
          const llmName = mashupData.name;

          // Debug until it compiles
          const debugResult = await this.debugShader(mashupSource);

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
            namedParameters = await this.updateParameterNames(debugResult.source, parameters);
          }

          // Create mashup shader with LLM-provided name or fallback
          const childNumber = i + 1;
          const uniqueSuffix = crypto.randomUUID().slice(0, 8);
          const parentNames = parentShaders.map(s => s.name).join(' + ');
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

          results.push({
            success: true,
            shader: mashupShaderDef,
          });
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
    promptParams: MashupPromptParams
  ): Promise<Array<{ name?: string; shader: string; changelog?: string }>> {
    const prompt = createMashupPrompt(promptParams);
    console.log(`Batch mashup with ${this.model}, params ${JSON.stringify({ count: promptParams.count, temperature: promptParams.temperature })}`);

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
        model: this.model,
        max_tokens: 16384, // Increased for multiple shaders
        temperature: promptParams.temperature,
        tools: [shaderObjectTool],
        tool_choice: { type: "tool", name: "shader_output" },
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Batch mashup call:`, {
        model: this.model,
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
        // Find the shader_output tool use
        const toolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'shader_output'
        );

        if (toolUse) {
          console.log(`Success: extracting mashup shaders`);
          const input = toolUse.input as { shaders: Array<{ name?: string; shader: string, changelog?: string }> };
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
    temperature: number
  ): Promise<Array<{ shader: string; changelog?: string }>> {
    const promptParams: BatchMutationPromptParams = {
      shaderSource,
      count,
      temperature,
      preserveParams: false,
    };

    const prompt = createBatchMutationPrompt(promptParams);
    console.log(`Batch mutating with ${this.model}, params ${JSON.stringify(promptParams)}`);

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
        model: this.model,
        max_tokens: 16384, // Increased for multiple shaders
        temperature,
        tools: [shaderObjectTool],
        tool_choice: { type: "tool", name: "shader_output" },
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Batch mutation call:`, {
        model: this.model,
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
        // Find the shader_output tool use
        const toolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'shader_output'
        );

        if (toolUse) {
          console.log(`Success: extracting shaders`);
          const input = toolUse.input as { shaders: Array<{ shader: string, changelog?: string }> };
          console.log(`Shaders: ${JSON.stringify(input.shaders, null, 2)}`)
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
    shaderSource: string
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

          currentSource = await this.requestLLMFix(currentSource, errorMessage, attempts);
        }
        continue;
      }

      // Compilation succeeded - now validate bindings
      // Detect if shader has parameters by checking for Params struct
      const hasParams = currentSource.includes('struct Params');
      const hasInputTexture = currentSource.includes('prevFrame');

      const bindingErrors = this.compiler.validateBindings(currentSource, hasParams, hasInputTexture);

      if (bindingErrors.length === 0) {
        // All validation passed!
        return {
          success: true,
          source: currentSource,
          attempts,
        };
      }

      // Binding validation failed - ask LLM to fix
      if (attempts < this.maxDebugAttempts) {
        const errorMessage = `Binding validation errors:\n${bindingErrors.join('\n')}`;
        console.log(`Shader has binding errors on attempt ${attempts}; errs=${errorMessage}. Asking LLM to debug`);

        currentSource = await this.requestLLMFix(currentSource, errorMessage, attempts);
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
    attempt: number
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
        model: this.model,
        max_tokens: 8192,
        temperature: 0.3, // Lower temperature for debugging
        tools: [debugShaderTool],
        tool_choice: { type: "tool", name: "debug_shader_output" },
        messages,
      });
      const elapsed = performance.now() - startTime;

      // Log timing and token usage
      console.log(`[LLM] Debug shader call (attempt ${attempt}):`, {
        model: this.model,
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
    parameters: ShaderParameter[]
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
          model: this.model,
          max_tokens: 2048,
          temperature: 0.3,
          tools: [parameterNamesTool],
          tool_choice: { type: "tool", name: "parameter_names_output" },
          messages,
        });
        const elapsed = performance.now() - startTime;

        // Log timing and token usage
        console.log(`[LLM] Parameter naming call:`, {
          model: this.model,
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
