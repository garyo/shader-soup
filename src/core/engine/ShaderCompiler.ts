/**
 * Shader Compiler - Compiles and validates WGSL shader code
 */

import { WebGPUContext } from './WebGPUContext';
import { ShaderCompilationError } from '@/types/errors';
import type { CompilationResult, CompilationError } from '@/types/core';

export class ShaderCompiler {
  private context: WebGPUContext;
  private compilationCache: Map<string, GPUShaderModule> = new Map();

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Compile WGSL shader source code
   * @param source - WGSL shader source code
   * @param label - Optional label for debugging
   * @param useCache - Whether to use cached compilation results (default: true)
   * @returns Compilation result with module or errors
   */
  public async compile(
    source: string,
    label?: string,
    useCache: boolean = true
  ): Promise<CompilationResult> {
    // Check cache if enabled
    if (useCache) {
      const cached = this.compilationCache.get(source);
      if (cached) {
        return {
          success: true,
          module: cached,
          errors: [],
        };
      }
    }

    // Validate source is not empty
    if (!source || source.trim().length === 0) {
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
        code: source,
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
        this.compilationCache.set(source, module);
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
    bindings: Array<{ group: number; binding: number; type: string }>;
  } {
    const entryPoints: string[] = [];
    const bindings: Array<{ group: number; binding: number; type: string }> = [];

    // Find entry points (@compute, @vertex, @fragment)
    const entryPointRegex = /@(compute|vertex|fragment)\s+fn\s+(\w+)/g;
    let match;

    while ((match = entryPointRegex.exec(source)) !== null) {
      entryPoints.push(match[2]);
    }

    // Find bindings (@group, @binding)
    const bindingRegex = /@group\((\d+)\)\s+@binding\((\d+)\)\s+var(?:<(\w+)>)?/g;

    while ((match = bindingRegex.exec(source)) !== null) {
      bindings.push({
        group: parseInt(match[1], 10),
        binding: parseInt(match[2], 10),
        type: match[3] || 'unknown',
      });
    }

    return { entryPoints, bindings };
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
