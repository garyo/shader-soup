/**
 * Shader Compiler - Compiles and validates WGSL shader code
 */

import { WebGPUContext } from './WebGPUContext';
import { ShaderCompilationError } from '@/types/errors';
import type { CompilationResult, CompilationError } from '@/types/core';
import noiseLibrary from '@/shaders/utils/noise.wgsl?raw';

export class ShaderCompiler {
  private context: WebGPUContext;
  private compilationCache: Map<string, GPUShaderModule> = new Map();
  private noiseLibrarySource: string = noiseLibrary;

  constructor(context: WebGPUContext) {
    this.context = context;
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
    includeNoiseLib: boolean = true
  ): Promise<CompilationResult> {
    // Prepend noise library if requested
    const finalSource = includeNoiseLib
      ? `${this.noiseLibrarySource}\n\n// ===== USER SHADER CODE =====\n\n${source}`
      : source;

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
    bindings: Array<{ group: number; binding: number; type: string; name: string }>;
  } {
    const entryPoints: string[] = [];
    const bindings: Array<{ group: number; binding: number; type: string; name: string }> = [];

    // Find entry points (@compute, @vertex, @fragment)
    const entryPointRegex = /@(compute|vertex|fragment)\s+fn\s+(\w+)/g;
    let match;

    while ((match = entryPointRegex.exec(source)) !== null) {
      entryPoints.push(match[2]);
    }

    // Find bindings (@group, @binding)
    // Updated regex to capture variable name and more type info
    const bindingRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var(?:<([^>]+)>)?\s+(\w+)/g;

    while ((match = bindingRegex.exec(source)) !== null) {
      bindings.push({
        group: parseInt(match[1], 10),
        binding: parseInt(match[2], 10),
        type: match[3] || 'unknown',
        name: match[4],
      });
    }

    return { entryPoints, bindings };
  }

  /**
   * Validate shader bindings against the standard layout
   * Returns validation errors if bindings don't match expected layout
   */
  public validateBindings(source: string, hasParams: boolean = false, hasInputTexture: boolean = false): string[] {
    const { bindings } = this.parseShaderMetadata(source);
    const errors: string[] = [];

    // Expected bindings based on standard layout
    const expectedBindings = [
      { binding: 0, expectedType: 'texture_2d<f32>', expectedName: 'coordTexture', description: 'coordinate texture' },
      { binding: 1, expectedType: 'sampler', expectedName: 'coordSampler', description: 'coordinate sampler' },
      { binding: 2, expectedType: 'storage', expectedName: 'output', description: 'output buffer' },
      { binding: 3, expectedType: 'uniform', expectedName: 'dimensions', description: 'dimensions uniform' },
    ];

    if (hasParams) {
      expectedBindings.push({ binding: 4, expectedType: 'uniform', expectedName: 'params', description: 'parameters uniform' });
    }

    if (hasInputTexture) {
      expectedBindings.push({ binding: 5, expectedType: 'texture_2d<f32>', expectedName: 'prevFrame', description: 'input texture' });
      expectedBindings.push({ binding: 6, expectedType: 'sampler', expectedName: 'prevFrameSampler', description: 'input sampler' });
    }

    // Check that all required bindings are present
    for (const expected of expectedBindings) {
      const actualBinding = bindings.find(b => b.group === 0 && b.binding === expected.binding);

      if (!actualBinding) {
        errors.push(`Missing required binding @group(0) @binding(${expected.binding}): ${expected.description} (should be 'var<${expected.expectedType.includes('texture') || expected.expectedType === 'sampler' ? '' : expected.expectedType}> ${expected.expectedName}: ${expected.expectedType}')`);
      } else {
        // Check type matches (simple check - could be more sophisticated)
        const typeMatches =
          actualBinding.type.includes('texture_2d') && expected.expectedType.includes('texture_2d') ||
          actualBinding.type === 'sampler' && expected.expectedType === 'sampler' ||
          actualBinding.type.includes('storage') && expected.expectedType === 'storage' ||
          actualBinding.type.includes('uniform') && expected.expectedType === 'uniform';

        if (!typeMatches) {
          errors.push(`Binding ${expected.binding} has wrong type: found '${actualBinding.type}', expected '${expected.expectedType}'`);
        }
      }
    }

    // Check for unexpected bindings in group 0
    for (const binding of bindings) {
      if (binding.group === 0) {
        const isExpected = expectedBindings.some(exp => exp.binding === binding.binding);
        if (!isExpected) {
          errors.push(`Unexpected binding @group(0) @binding(${binding.binding}): '${binding.name}'. Only bindings 0-${expectedBindings.length - 1} are allowed.`);
        }
      } else {
        errors.push(`Shader uses @group(${binding.group}) but only @group(0) is supported`);
      }
    }

    return errors;
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
