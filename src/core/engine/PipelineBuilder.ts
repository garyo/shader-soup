/**
 * Pipeline Builder - Fluent API for creating compute pipelines and bind groups
 */

import { WebGPUContext } from './WebGPUContext';
import { PipelineCreationError } from '@/types/errors';
import type { ComputePipelineConfig, ResourceBinding } from '@/types/core';

export class PipelineBuilder {
  private context: WebGPUContext;
  private pipelineCache: Map<string, GPUComputePipeline> = new Map();

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Create a compute pipeline
   * @param config - Pipeline configuration
   * @param useCache - Whether to use cached pipeline (default: true)
   * @returns GPU compute pipeline
   */
  public createPipeline(config: ComputePipelineConfig, useCache: boolean = true): GPUComputePipeline {
    const device = this.context.getDevice();

    // Generate cache key
    const cacheKey = this.getPipelineCacheKey(config);

    // Check cache
    if (useCache) {
      const cached = this.pipelineCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      // Create pipeline layout
      const pipelineLayout = device.createPipelineLayout({
        label: config.label ? `${config.label}-layout` : 'pipeline-layout',
        bindGroupLayouts: config.bindGroupLayouts,
      });

      // Create compute pipeline
      const pipeline = device.createComputePipeline({
        label: config.label,
        layout: pipelineLayout,
        compute: {
          module: config.shader,
          entryPoint: config.entryPoint,
        },
      });

      // Cache pipeline
      if (useCache) {
        this.pipelineCache.set(cacheKey, pipeline);
      }

      return pipeline;
    } catch (error) {
      throw new PipelineCreationError(
        `Failed to create pipeline: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create a bind group layout
   * @param entries - Array of bind group layout entries
   * @param label - Optional label
   * @returns GPU bind group layout
   */
  public createBindGroupLayout(
    entries: GPUBindGroupLayoutEntry[],
    label?: string
  ): GPUBindGroupLayout {
    const device = this.context.getDevice();

    return device.createBindGroupLayout({
      label,
      entries,
    });
  }

  /**
   * Create a bind group
   * @param layout - Bind group layout
   * @param bindings - Resource bindings
   * @param label - Optional label
   * @returns GPU bind group
   */
  public createBindGroup(
    layout: GPUBindGroupLayout,
    bindings: ResourceBinding[],
    label?: string
  ): GPUBindGroup {
    const device = this.context.getDevice();

    const entries: GPUBindGroupEntry[] = bindings.map((binding) => ({
      binding: binding.binding,
      resource: binding.resource,
    }));

    return device.createBindGroup({
      label,
      layout,
      entries,
    });
  }

  /**
   * Create a simple bind group layout for storage buffers
   * @param count - Number of storage buffers
   * @param label - Optional label
   * @returns GPU bind group layout
   */
  public createStorageBufferLayout(count: number, label?: string): GPUBindGroupLayout {
    const entries: GPUBindGroupLayoutEntry[] = [];

    for (let i = 0; i < count; i++) {
      entries.push({
        binding: i,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        },
      });
    }

    return this.createBindGroupLayout(entries, label);
  }

  /**
   * Create a bind group layout for typical shader inputs (texture-based coords)
   * - Binding 0: Coordinate texture (texture_2d<f32>)
   * - Binding 1: Coordinate sampler (sampler with mirror-repeat)
   * - Binding 2: Output buffer (storage, read-write)
   * - Binding 3: Dimensions (uniform, always present)
   * - Binding 4: Parameters (uniform, optional)
   * - Binding 5-6: Input texture/sampler (optional)
   *
   * @param hasParams - Whether shader has parameters
   * @param hasInputTexture - Whether shader has input texture (for image processing)
   * @param label - Optional label
   * @returns GPU bind group layout
   */
  public createStandardLayout(
    hasParams: boolean = false,
    hasInputTexture: boolean = false,
    label?: string
  ): GPUBindGroupLayout {
    const entries: GPUBindGroupLayoutEntry[] = [
      // Binding 0: Coordinate texture (rgba16float is filterable)
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: 'float',
          viewDimension: '2d',
        },
      },
      // Binding 1: Coordinate sampler (filtering for rgba16float)
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        sampler: {
          type: 'filtering',
        },
      },
      // Binding 2: Output texture (rgba16float for HDR-capable rendering)
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: this.context.getStorageFormat() as GPUTextureFormat,
          viewDimension: '2d',
        },
      },
      // Binding 3: Dimensions (uniform, always present)
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
        },
      },
    ];

    // Binding 4: Parameters (uniform)
    if (hasParams) {
      entries.push({
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
        },
      });
    }

    // Binding 5-6: Input texture and sampler (optional, for image processing or feedback)
    if (hasInputTexture) {
      entries.push({
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: 'unfilterable-float', // Use unfilterable for rgba32float feedback textures
          viewDimension: '2d',
        },
      });

      entries.push({
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        sampler: {
          type: 'non-filtering', // Non-filtering sampler for rgba32float
        },
      });
    }

    return this.createBindGroupLayout(entries, label);
  }

  /**
   * Create a standard bind group for shader execution (texture-based coords)
   * @param layout - Bind group layout
   * @param coordTexture - Coordinate texture
   * @param coordSampler - Coordinate sampler
   * @param outputTexture - Output texture (canvas texture or offscreen texture)
   * @param dimensionsBuffer - Dimensions buffer (always required)
   * @param paramBuffer - Optional parameter buffer
   * @param inputTexture - Optional input texture (for image processing)
   * @param inputSampler - Optional input sampler (required if inputTexture provided)
   * @param label - Optional label
   * @returns GPU bind group
   */
  public createStandardBindGroup(
    layout: GPUBindGroupLayout,
    coordTexture: GPUTexture,
    coordSampler: GPUSampler,
    outputTexture: GPUTexture,
    dimensionsBuffer: GPUBuffer,
    paramBuffer?: GPUBuffer,
    inputTexture?: GPUTexture,
    inputSampler?: GPUSampler,
    label?: string
  ): GPUBindGroup {
    const bindings: ResourceBinding[] = [
      {
        binding: 0,
        resource: coordTexture.createView(),
      },
      {
        binding: 1,
        resource: coordSampler,
      },
      {
        binding: 2,
        resource: outputTexture.createView(),
      },
      {
        binding: 3,
        resource: { buffer: dimensionsBuffer },
      },
    ];

    if (paramBuffer) {
      bindings.push({
        binding: 4,
        resource: { buffer: paramBuffer },
      });
    }

    if (inputTexture) {
      bindings.push({
        binding: 5,
        resource: inputTexture.createView(),
      });

      if (inputSampler) {
        bindings.push({
          binding: 6,
          resource: inputSampler,
        });
      }
    }

    return this.createBindGroup(layout, bindings, label);
  }

  /**
   * Generate cache key for pipeline
   */
  private getPipelineCacheKey(config: ComputePipelineConfig): string {
    // Simple cache key based on label and entry point
    return `${config.label || 'pipeline'}-${config.entryPoint}`;
  }

  /**
   * Clear pipeline cache
   */
  public clearCache(): void {
    this.pipelineCache.clear();
  }

  /**
   * Get cache size
   */
  public getCacheSize(): number {
    return this.pipelineCache.size;
  }
}
