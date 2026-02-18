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

