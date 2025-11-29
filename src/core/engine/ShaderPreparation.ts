/**
 * Shader Preparation Utility
 * Consolidates shader compilation, buffer creation, and pipeline setup
 */

import type { ShaderCompiler } from './ShaderCompiler';
import type { BufferManager } from './BufferManager';
import type { ParameterManager } from './ParameterManager';
import type { PipelineBuilder } from './PipelineBuilder';
import type { Executor } from './Executor';
import type { WebGPUContext } from './WebGPUContext';
import type { ShaderDefinition } from '@/types/core';

/**
 * Options for shader preparation
 */
export interface ShaderPreparationOptions {
  /** Shader definition */
  shader: ShaderDefinition;
  /** Shader ID from store */
  shaderId: string;
  /** Dimensions for rendering */
  dimensions: { width: number; height: number };
  /** Label suffix for buffers (e.g., '', 'hires') */
  labelSuffix?: string;
  /** Parameter values override (if not provided, uses shader defaults or store values) */
  parameterValues?: Map<string, number>;
  /** Iteration value override (if not provided, uses store value or shader default) */
  iterations?: number;
  /** Whether to measure compilation time */
  measureCompileTime?: boolean;
}

/**
 * Result of shader preparation containing all resources needed for execution
 */
export interface ShaderPreparationResult {
  /** Compiled shader module */
  shaderModule: GPUShaderModule;
  /** Output texture for shader results (rgba16float HDR) */
  outputTexture: GPUTexture;
  /** Dimensions buffer */
  dimensionsBuffer: GPUBuffer;
  /** Parameter buffer (undefined if shader has no parameters) */
  paramBuffer: GPUBuffer | undefined;
  /** Bind group layout */
  layout: GPUBindGroupLayout;
  /** Compute pipeline */
  pipeline: GPUComputePipeline;
  /** Workgroup dimensions */
  workgroups: { x: number; y: number };
  /** Number of iterations to execute */
  iterations: number;
  /** Whether shader has iterations (feedback loop) */
  hasIterations: boolean;
  /** Whether shader has parameters */
  hasParams: boolean;
  /** Compilation time in milliseconds (only if measureCompileTime was true) */
  compileTime?: number;
}

/**
 * Prepares a shader for execution by compiling it and creating all necessary resources
 *
 * This helper consolidates the repetitive setup phase:
 * - Compiles shader and validates
 * - Creates output buffer
 * - Creates dimensions buffer
 * - Creates parameter buffer (if needed)
 * - Determines iteration count and flags
 * - Creates bind group layout and pipeline
 * - Calculates workgroup dimensions
 *
 * @param compiler - Shader compiler instance
 * @param bufferManager - Buffer manager instance
 * @param parameterManager - Parameter manager instance
 * @param pipelineBuilder - Pipeline builder instance
 * @param executor - Executor instance for workgroup calculation
 * @param options - Preparation options
 * @returns Preparation result with all resources needed for execution
 * @throws Error if compilation fails
 *
 * @example
 * const prep = await prepareShader(compiler, bufferManager, parameterManager,
 *   pipelineBuilder, executor, {
 *     shader, shaderId, dimensions: {width: 512, height: 512},
 *     labelSuffix: 'hires', parameterValues, iterations
 *   });
 * // Use prep.pipeline, prep.outputBuffer, etc.
 */
export async function prepareShader(
  compiler: ShaderCompiler,
  bufferManager: BufferManager,
  parameterManager: ParameterManager,
  pipelineBuilder: PipelineBuilder,
  executor: Executor,
  context: WebGPUContext,
  getIterationValue: (shaderId: string) => number | undefined,
  getParameterValues: (shaderId: string) => Map<string, number> | undefined,
  options: ShaderPreparationOptions
): Promise<ShaderPreparationResult> {
  const { shader, shaderId, dimensions, labelSuffix = '', measureCompileTime = false } = options;

  // Create output texture (HDR-capable rgba16float)
  const label = labelSuffix ? `-${labelSuffix}` : '';
  const device = context.getDevice();
  const outputTexture = device.createTexture({
    size: { width: dimensions.width, height: dimensions.height },
    format: context.getStorageFormat() as GPUTextureFormat,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    label: `output-texture${label}`,
  });

  // Compile shader
  const startCompile = measureCompileTime ? performance.now() : 0;
  const compilationResult = await compiler.compile(shader.source, shader.cacheKey);

  if (!compilationResult.success || !compilationResult.module) {
    throw new Error(`Compilation failed: ${compiler.constructor.name === 'ShaderCompiler' ?
      (compiler as any).constructor.formatErrors?.(compilationResult.errors) || compilationResult.errors?.join('\n') :
      'Unknown error'}`);
  }

  const compileTime = measureCompileTime ? performance.now() - startCompile : undefined;

  // Create dimensions buffer
  const dimensionsData = new Uint32Array([dimensions.width, dimensions.height, 0, 0]);
  const dimensionsBuffer = bufferManager.createBufferWithData(
    dimensionsData as BufferSource,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    `dimensions${label}`
  );

  // Detect binding declarations in shader source
  const bindingDetection = compiler.detectOptionalBindings(shader.source);

  // Create parameter buffer if shader has parameters
  let paramBuffer: GPUBuffer | undefined;
  const hasParamComments = shader.parameters.length > 0;

  // If shader declares @binding(4) but has no @param comments, create a dummy params buffer
  if (bindingDetection.hasParamsBinding) {
    if (hasParamComments) {
      // Normal case: shader has @param comments, use those values
      const paramValues = options.parameterValues ?? getParameterValues(shaderId) ?? new Map();
      paramBuffer = parameterManager.createParameterBuffer(shader.parameters, paramValues);
    } else {
      // Mismatch case: shader declares @binding(4) but no @param comments
      // Create a dummy buffer to satisfy the binding requirement
      console.warn(`Shader declares @binding(4) but has no // @param comments. Creating dummy params buffer.`);
      // Create a larger dummy buffer to handle typical Params structs
      // WebGPU requires uniform buffers to be multiples of 16 bytes
      // Using 256 bytes should cover most cases (16 float parameters)
      paramBuffer = bufferManager.createBuffer(
        {
          size: 256,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `dummy-params${label}`,
        },
        false
      );
    }
  } else if (hasParamComments) {
    // Edge case: shader has @param comments but no @binding(4) declaration
    console.warn(`Shader has // @param comments but no @binding(4) declaration. Parameters will be ignored.`);
  }

  // Determine iteration count and flags
  const iterations = options.iterations ?? getIterationValue(shaderId) ?? shader.iterations ?? 1;
  const hasIterations = iterations > 1;
  const hasParams = bindingDetection.hasParamsBinding; // Use actual binding detection, not just comment parsing

  // Create bind group layout and pipeline
  const layout = pipelineBuilder.createStandardLayout(hasParams, hasIterations, shader.cacheKey);
  const pipeline = pipelineBuilder.createPipeline({
    shader: compilationResult.module,
    entryPoint: 'main',
    bindGroupLayouts: [layout],
    label: shader.cacheKey,
  });

  // Calculate workgroups
  const workgroups = executor.calculateWorkgroups(dimensions.width, dimensions.height);

  return {
    shaderModule: compilationResult.module,
    outputTexture,
    dimensionsBuffer,
    paramBuffer,
    layout,
    pipeline,
    workgroups,
    iterations,
    hasIterations,
    hasParams,
    compileTime,
  };
}
