/**
 * Shader Compiler - Compiles and validates WGSL shader code
 */

import { WebGPUContext } from './WebGPUContext';
import { ShaderCompilationError } from '@/types/errors';
import type { CompilationResult, CompilationError } from '@/types/core';
import noiseLibrary from '@/shaders/utils/noise.wgsl?raw';
import utilsLibrary from '@/shaders/utils/utils.wgsl?raw';

export class ShaderCompiler {
  private context: WebGPUContext;
  private compilationCache: Map<string, GPUShaderModule> = new Map();
  private noiseLibrarySource: string = noiseLibrary;
  private utilsLibrarySource: string = utilsLibrary;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Get the library prefix that's prepended to user shader code
   * @returns The complete library prefix string
   */
  private getLibraryPrefix(): string {
    return `${this.noiseLibrarySource}\n\n// UTILS\n\n${this.utilsLibrarySource}\n\n// ===== USER SHADER CODE =====\n\n`;
  }

  /**
   * Compile WGSL shader source code
   * @param source - WGSL shader source code
   * @param label - Optional label for debugging
   * @param useCache - Whether to use cached compilation results (default: true)
   * @param includeNoiseLib - Whether to prepend noise library (default: true)
   * @returns Compilation result with module or errors
   */
  public async compile(
    source: string,
    label?: string,
    useCache: boolean = true,
  ): Promise<CompilationResult> {
    // Prepend noise & utils libs
    const finalSource = this.getLibraryPrefix() + source;

    // Check cache if enabled
    if (useCache) {
      const cached = this.compilationCache.get(finalSource);
      if (cached) {
        return {
          success: true,
          module: cached,
          errors: [],
        };
      }
    }

    // Validate source is not empty
    if (!finalSource || finalSource.trim().length === 0) {
      return {
        success: false,
        errors: [{ message: 'Shader source code is empty' }],
      };
    }

    const device = this.context.getDevice();

    try {
      // Create shader module
      const module = device.createShaderModule({
        label: label || 'shader',
        code: finalSource,
      });

      // Get compilation info
      const compilationInfo = await module.getCompilationInfo();

      // Check for errors or warnings
      const errors: CompilationError[] = [];
      const warnings: CompilationError[] = [];

      for (const message of compilationInfo.messages) {
        const error: CompilationError = {
          message: message.message,
          line: message.lineNum,
          column: message.linePos,
        };

        if (message.type === 'error') {
          errors.push(error);
        } else if (message.type === 'warning') {
          warnings.push(error);
        }
      }

      // Log warnings
      if (warnings.length > 0) {
        console.warn('Shader compilation warnings:', warnings);
      }

      // If there are errors, compilation failed
      if (errors.length > 0) {
        return {
          success: false,
          errors,
        };
      }

      // Cache successful compilation
      if (useCache) {
        this.compilationCache.set(finalSource, module);
      }

      return {
        success: true,
        module,
        errors: [],
      };
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown compilation error';

      return {
        success: false,
        errors: [
          {
            message: errorMessage,
          },
        ],
      };
    }
  }

  /**
   * Compile shader source and throw on error
   * @param source - WGSL shader source code
   * @param label - Optional label for debugging
   * @returns GPU shader module
   * @throws {ShaderCompilationError} if compilation fails
   */
  public async compileOrThrow(source: string, label?: string): Promise<GPUShaderModule> {
    const result = await this.compile(source, label);

    if (!result.success) {
      throw new ShaderCompilationError('Shader compilation failed', result.errors);
    }

    return result.module!;
  }

  /**
   * Validate shader source without creating a module
   * @param source - WGSL shader source code
   * @returns Validation result with any errors
   */
  public async validate(source: string): Promise<CompilationResult> {
    // Use compile but don't cache
    return this.compile(source, 'validation', false);
  }

  /**
   * Parse shader source for metadata (entry points, bindings, etc.)
   * This is a basic implementation that looks for common patterns
   */
  public parseShaderMetadata(source: string): {
    entryPoints: string[];
    bindings: Array<{ group: number; binding: number; type: string; storageModifier?: string; name: string }>;
  } {
    const entryPoints: string[] = [];
    const bindings: Array<{ group: number; binding: number; type: string; storageModifier?: string; name: string }> = [];

    // Find entry points (@compute, @vertex, @fragment)
    const entryPointRegex = /@(compute|vertex|fragment)\s+fn\s+(\w+)/g;
    let match;

    while ((match = entryPointRegex.exec(source)) !== null) {
      entryPoints.push(match[2]);
    }

    // Find bindings (@group, @binding)
    // Regex captures: group, binding, optional storage modifier, var name, and type after colon
    const bindingRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var(?:<([^>]+)>)?\s+(\w+)\s*:\s*([^;]+)/g;

    while ((match = bindingRegex.exec(source)) !== null) {
      const storageModifier = match[3]?.trim(); // e.g., "storage", "uniform"
      const varType = match[5].trim(); // e.g., "texture_2d<f32>", "sampler", "array<vec4<f32>>"

      bindings.push({
        group: parseInt(match[1], 10),
        binding: parseInt(match[2], 10),
        type: varType,
        storageModifier: storageModifier,
        name: match[4],
      });
    }

    return { entryPoints, bindings };
  }

  /**
   * Validate shader by attempting to create a GPU pipeline
   * This uses actual GPU validation instead of regex parsing
   * Returns validation errors if pipeline creation fails
   */
  public async validatePipeline(
    module: GPUShaderModule,
    hasParams: boolean = false,
    hasInputTexture: boolean = false
  ): Promise<string[]> {
    const device = this.context.getDevice();
    const errors: string[] = [];

    try {
      // Create bind group layout matching our standard layout (updated - no coord texture)
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        // Binding 0: Output texture (storage)
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba32float' as GPUTextureFormat,
            viewDimension: '2d',
          },
        },
        // Binding 1: Dimensions (includes zoom/pan)
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        },
      ];

      if (hasParams) {
        layoutEntries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        });
      }

      if (hasInputTexture) {
        layoutEntries.push({
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          texture: {
            sampleType: 'unfilterable-float',
            viewDimension: '2d',
          },
        });
        layoutEntries.push({
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          sampler: {
            type: 'non-filtering',
          },
        });
      }

      const bindGroupLayout = device.createBindGroupLayout({
        label: 'validation-layout',
        entries: layoutEntries,
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'validation-pipeline-layout',
        bindGroupLayouts: [bindGroupLayout],
      });

      // Try to create the pipeline - this will throw if bindings don't match
      device.createComputePipeline({
        label: 'validation-pipeline',
        layout: pipelineLayout,
        compute: {
          module: module,
          entryPoint: 'main',
          constants: {},
        },
      });

      // If we get here, validation passed!
      return [];
    } catch (error) {
      // GPU validation failed - extract error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      return errors;
    }
  }

  /**
   * Detect if shader source declares a binding that should be included in hasParams/hasInputTexture
   * This helps catch mismatches where LLM declares @binding(2) but didn't add // @param comments
   *
   * @param source - User shader source code (without prepended libraries)
   * @returns Object indicating which optional bindings are declared
   */
  public detectOptionalBindings(source: string): { hasParamsBinding: boolean; hasInputTextureBinding: boolean } {
    // Check if shader declares @binding(2) for params (updated from binding 4)
    const hasParamsBinding = /@group\(0\)\s+@binding\(2\)/.test(source);

    // Check if shader declares @binding(3) for input texture (updated from binding 5)
    const hasInputTextureBinding = /@group\(0\)\s+@binding\(3\)/.test(source);

    return { hasParamsBinding, hasInputTextureBinding };
  }

  /**
   * Clear the compilation cache
   */
  public clearCache(): void {
    this.compilationCache.clear();
  }

  /**
   * Get cache size
   */
  public getCacheSize(): number {
    return this.compilationCache.size;
  }

  /**
   * Get the line offset for user code (number of newlines before user code starts)
   * This is used to adjust line numbers in compilation errors
   */
  public getUserCodeLineOffset(): number {
    // Count newlines in the library prefix (using the exact same string used in compile())
    const prefix = this.getLibraryPrefix();
    const newlineCount = (prefix.match(/\n/g) || []).length;
    return newlineCount;
  }

  /**
   * Format compilation errors for display
   */
  public static formatErrors(errors: CompilationError[]): string {
    if (errors.length === 0) {
      return 'No errors';
    }

    return errors
      .map((error) => {
        const location = error.line ? ` at line ${error.line}${error.column ? `:${error.column}` : ''}` : '';
        return `  ${error.message}${location}`;
      })
      .join('\n');
  }
}
