/**
 * Core type definitions for the WebGPU shader engine
 */

/**
 * 2D dimensions for images and buffers
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Workgroup dimensions for compute shader dispatch
 */
export interface WorkgroupDimensions {
  x: number;
  y: number;
  z?: number;
}

/**
 * Shader parameter definition
 */
export interface ShaderParameter {
  name: string;
  min: number;
  max: number;
  default: number;
  step: number;
}

/**
 * Shader definition with source code and metadata
 */
export interface ShaderDefinition {
  id: string;
  name: string; // User-friendly display name
  cacheKey: string; // Internal unique name for compilation/caching
  source: string;
  parameters: ShaderParameter[];
  description?: string;
  changelog?: string; // Summary of changes in evolved versions
  iterations?: number; // Number of feedback iterations (default: 1)
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * Result from shader execution
 */
export interface ShaderResult {
  shaderId: string;
  imageData: ImageData;
  executionTime: number;
  timestamp: Date;
  error?: string;
}

/**
 * GPU buffer descriptor
 */
export interface BufferDescriptor {
  size: number;
  usage: GPUBufferUsageFlags;
  label?: string;
}

/**
 * Shader compilation result
 */
export interface CompilationResult {
  success: boolean;
  module?: GPUShaderModule;
  errors: CompilationError[];
}

/**
 * Shader compilation error with location
 */
export interface CompilationError {
  message: string;
  line?: number;
  column?: number;
}

/**
 * Buffer pool entry for reuse
 */
export interface PooledBuffer {
  buffer: GPUBuffer;
  size: number;
  usage: GPUBufferUsageFlags;
  inUse: boolean;
  lastUsed: number;
}

/**
 * Compute pipeline configuration
 */
export interface ComputePipelineConfig {
  shader: GPUShaderModule;
  entryPoint: string;
  bindGroupLayouts: GPUBindGroupLayout[];
  label?: string;
}

/**
 * Bind group resource binding
 */
export interface ResourceBinding {
  binding: number;
  resource: GPUBindingResource;
}

/**
 * Execution context for a shader
 */
export interface ExecutionContext {
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  workgroups: WorkgroupDimensions;
  outputBuffer: GPUBuffer;
}

/**
 * Validation result for type checking
 */
export interface ValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  errors: string[];
}

/**
 * Performance metrics for shader execution
 */
export interface PerformanceMetrics {
  compilationTime: number;
  executionTime: number;
  bufferUploadTime: number;
  bufferDownloadTime: number;
  totalTime: number;
}

// Type guards

export function isDimensions(value: unknown): value is Dimensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'width' in value &&
    'height' in value &&
    typeof (value as Dimensions).width === 'number' &&
    typeof (value as Dimensions).height === 'number' &&
    (value as Dimensions).width > 0 &&
    (value as Dimensions).height > 0
  );
}

export function isShaderParameter(value: unknown): value is ShaderParameter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'min' in value &&
    'max' in value &&
    'default' in value &&
    'step' in value &&
    typeof (value as ShaderParameter).name === 'string' &&
    typeof (value as ShaderParameter).min === 'number' &&
    typeof (value as ShaderParameter).max === 'number' &&
    typeof (value as ShaderParameter).default === 'number' &&
    typeof (value as ShaderParameter).step === 'number'
  );
}

export function isWorkgroupDimensions(value: unknown): value is WorkgroupDimensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    'y' in value &&
    typeof (value as WorkgroupDimensions).x === 'number' &&
    typeof (value as WorkgroupDimensions).y === 'number' &&
    (value as WorkgroupDimensions).x > 0 &&
    (value as WorkgroupDimensions).y > 0
  );
}

// Validators

export function validateDimensions(value: unknown): ValidationResult<Dimensions> {
  if (!isDimensions(value)) {
    return {
      valid: false,
      errors: ['Invalid dimensions: must have positive width and height'],
    };
  }

  if (value.width > 8192 || value.height > 8192) {
    return {
      valid: false,
      errors: ['Dimensions too large: maximum 8192x8192'],
    };
  }

  return { valid: true, value, errors: [] };
}

export function validateShaderParameter(value: unknown): ValidationResult<ShaderParameter> {
  if (!isShaderParameter(value)) {
    return {
      valid: false,
      errors: ['Invalid parameter: must have name, min, max, default, and step'],
    };
  }

  const errors: string[] = [];

  if (value.min >= value.max) {
    errors.push(`Parameter ${value.name}: min must be less than max`);
  }

  if (value.default < value.min || value.default > value.max) {
    errors.push(`Parameter ${value.name}: default must be between min and max`);
  }

  if (value.step <= 0) {
    errors.push(`Parameter ${value.name}: step must be positive`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value, errors: [] };
}
