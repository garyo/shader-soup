/**
 * Custom error types for the WebGPU shader engine
 */

/**
 * Base error class for WebGPU engine errors
 */
export class WebGPUEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUEngineError';
  }
}

/**
 * Error thrown when WebGPU is not supported or initialization fails
 */
export class WebGPUNotSupportedError extends WebGPUEngineError {
  constructor(message: string = 'WebGPU is not supported in this environment') {
    super(message);
    this.name = 'WebGPUNotSupportedError';
  }
}

/**
 * Error thrown during shader compilation
 */
export class ShaderCompilationError extends WebGPUEngineError {
  public readonly errors: Array<{ line?: number; column?: number; message: string }>;

  constructor(
    message: string,
    errors: Array<{ line?: number; column?: number; message: string }> = []
  ) {
    super(message);
    this.name = 'ShaderCompilationError';
    this.errors = errors;
  }
}

/**
 * Error thrown during GPU execution
 */
export class GPUExecutionError extends WebGPUEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'GPUExecutionError';
  }
}

/**
 * Error thrown when buffer allocation fails
 */
export class BufferAllocationError extends WebGPUEngineError {
  public readonly requestedSize: number;

  constructor(message: string, requestedSize: number) {
    super(message);
    this.name = 'BufferAllocationError';
    this.requestedSize = requestedSize;
  }
}

/**
 * Error thrown when parameter validation fails
 */
export class ParameterValidationError extends WebGPUEngineError {
  public readonly parameterName: string;

  constructor(message: string, parameterName: string) {
    super(message);
    this.name = 'ParameterValidationError';
    this.parameterName = parameterName;
  }
}

/**
 * Error thrown when pipeline creation fails
 */
export class PipelineCreationError extends WebGPUEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineCreationError';
  }
}

/**
 * Format error for display to users
 */
export function formatError(error: unknown): string {
  if (error instanceof ShaderCompilationError) {
    const errorLines = error.errors
      .map((e) => {
        const location = e.line ? ` (line ${e.line}${e.column ? `:${e.column}` : ''})` : '';
        return `  - ${e.message}${location}`;
      })
      .join('\n');

    return `Shader Compilation Failed:\n${errorLines}`;
  }

  if (error instanceof BufferAllocationError) {
    return `Buffer Allocation Failed: ${error.message}\nRequested size: ${error.requestedSize} bytes`;
  }

  if (error instanceof ParameterValidationError) {
    return `Parameter Validation Failed: ${error.message}\nParameter: ${error.parameterName}`;
  }

  if (error instanceof WebGPUEngineError) {
    return `${error.name}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
