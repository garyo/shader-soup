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
  shaderObjectTool,
  debugShaderTool,
  parameterNamesTool,
  type BatchMutationPromptParams,
  type DebugPromptParams,
  type ParameterNamingPromptParams,
} from './prompts';

export interface EvolutionOptions {
  temperature?: number;
  maxDebugAttempts?: number;
  model?: string;
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
    this.model = options?.model ?? 'claude-sonnet-4-5';
    this.temperature = options?.temperature ?? 0.5; // TODO use defaultTemperature
  }

  /**
   * Evolve multiple shader variations in a single batch call
   */
  public async evolveShaderBatch(
    parentShader: ShaderDefinition,
    count: number = 10,
    temperature?: number
  ): Promise<EvolutionResult[]> {
    // Use provided temperature or fall back to instance temperature
    const effectiveTemp = temperature ?? this.temperature;

    try {
      // Generate all mutations in one API call
      const mutatedShaders = await this.batchMutateShader(parentShader.source, count, effectiveTemp);

      const results: EvolutionResult[] = [];

      // Process each mutated shader
      for (let i = 0; i < mutatedShaders.length; i++) {
        try {
          const mutatedSource = mutatedShaders[i];

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

          // Parse parameters
          const parameters = this.parameterManager.parseParameters(debugResult.source);

          // Update parameter names
          const namedParameters = await this.updateParameterNames(debugResult.source, parameters);

          // Create child shader with hierarchical naming
          const childNumber = i + 1;
          const uniqueSuffix = crypto.randomUUID().slice(0, 8);
          const childShader: ShaderDefinition = {
            id: crypto.randomUUID(),
            name: `${parentShader.name}.${childNumber}`, // Hierarchical name (e.g., "Sine Wave.1.3.2")
            cacheKey: `${parentShader.cacheKey}-${childNumber}-${uniqueSuffix}`, // Unique cache key
            source: debugResult.source,
            parameters: namedParameters,
            description: `Evolved from "${parentShader.name}"`,
            createdAt: new Date(),
            modifiedAt: new Date(),
          };

          results.push({
            success: true,
            shader: childShader,
            debugAttempts: debugResult.attempts,
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
   * Batch mutate shader - generate multiple variations at once
   */
  private async batchMutateShader(shaderSource: string, count: number, temperature: number): Promise<string[]> {
    const promptParams: BatchMutationPromptParams = {
      shaderSource,
      count,
      temperature,
      preserveParams: true,
    };

    const prompt = createBatchMutationPrompt(promptParams);
    console.log(`Batch mutating with params ${JSON.stringify(promptParams)}`);

    // Create messages array for conversation
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: prompt,
      },
    ];

    // Loop to handle tool calls
    while (true) {
      const message = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 16384, // Increased for multiple shaders
        temperature,
        tools: [shaderObjectTool],
        tool_choice: { type: "tool", name: "shader_output" },
        messages,
      });

      console.log(`Got response with stop_reason: ${message.stop_reason}`);

      // Check if the model used the tool
      if (message.stop_reason === 'tool_use') {
        // Find the shader_output tool use
        const toolUse = message.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === 'tool_use' && block.name === 'shader_output'
        );

        if (toolUse) {
          console.log(`Tool used successfully, extracting shaders`);
          const input = toolUse.input as { shaders: Array<{ shader: string }> };
          return input.shaders.map(s => s.shader);
        }
      }

      // If we get here without finding the tool use, something went wrong
      throw new Error(`Unexpected stop reason: ${message.stop_reason}`);
    }
  }


  /**
   * Debug shader with compilation feedback loop
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

      if (result.success) {
        return {
          success: true,
          source: currentSource,
          attempts,
        };
      }

      // If failed and not last attempt, ask LLM to fix
      if (attempts < this.maxDebugAttempts) {
        const errorMessage = ShaderCompiler.formatErrors(result.errors);

        const promptParams: DebugPromptParams = {
          shaderSource: currentSource,
          errors: errorMessage,
          attempt: attempts,
        };

        const prompt = createDebugPrompt(promptParams);
        console.log(`Debug attempt ${attempts}, asking LLM to fix errors`);

        // Create messages array for conversation
        const messages: Anthropic.MessageParam[] = [
          {
            role: 'user',
            content: prompt,
          },
        ];

        // Loop to handle tool calls
        while (true) {
          const message = await this.anthropic.messages.create({
            model: this.model,
            max_tokens: 8192,
            temperature: 0.3, // Lower temperature for debugging
            tools: [debugShaderTool],
            tool_choice: { type: "tool", name: "debug_shader_output" },
            messages,
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
              currentSource = input.shader;
              break;
            }
          }

          // If we get here without finding the tool use, something went wrong
          throw new Error(`Debug: unexpected stop reason: ${message.stop_reason}`);
        }
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
        const message = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: 2048,
          temperature: 0.3,
          tools: [parameterNamesTool],
          tool_choice: { type: "tool", name: "parameter_names_output" },
          messages,
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
