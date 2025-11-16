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
   * Create a bind group layout for typical shader inputs
   * - Binding 0: Input coordinates (storage, read-only)
   * - Binding 1: Output buffer (storage, read-write)
   * - Binding 2: Parameters (uniform, optional)
   * - Binding 3: Input texture (optional)
   *
   * @param hasParams - Whether shader has parameters
   * @param hasTexture - Whether shader has input texture
   * @param label - Optional label
   * @returns GPU bind group layout
   */
  public createStandardLayout(
    hasParams: boolean = false,
    hasTexture: boolean = false,
    label?: string
  ): GPUBindGroupLayout {
    const entries: GPUBindGroupLayoutEntry[] = [
      // Binding 0: Input coordinates (read-only storage)
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'read-only-storage',
        },
      },
      // Binding 1: Output buffer (read-write storage)
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'storage',
        },
      },
    ];

    // Binding 2: Parameters (uniform)
    if (hasParams) {
      entries.push({
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
        },
      });
    }

    // Binding 3: Input texture (optional)
    if (hasTexture) {
      entries.push({
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: 'float',
          viewDimension: '2d',
        },
      });

      // Binding 4: Sampler for texture
      entries.push({
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        sampler: {
          type: 'filtering',
        },
      });
    }

    return this.createBindGroupLayout(entries, label);
  }

  /**
   * Create a standard bind group for shader execution
   * @param layout - Bind group layout
   * @param coordBuffer - Coordinate buffer
   * @param outputBuffer - Output buffer
   * @param paramBuffer - Optional parameter buffer
   * @param texture - Optional input texture
   * @param sampler - Optional sampler (required if texture provided)
   * @param label - Optional label
   * @returns GPU bind group
   */
  public createStandardBindGroup(
    layout: GPUBindGroupLayout,
    coordBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    paramBuffer?: GPUBuffer,
    texture?: GPUTexture,
    sampler?: GPUSampler,
    label?: string
  ): GPUBindGroup {
    const bindings: ResourceBinding[] = [
      {
        binding: 0,
        resource: { buffer: coordBuffer },
      },
      {
        binding: 1,
        resource: { buffer: outputBuffer },
      },
    ];

    if (paramBuffer) {
      bindings.push({
        binding: 2,
        resource: { buffer: paramBuffer },
      });
    }

    if (texture) {
      bindings.push({
        binding: 3,
        resource: texture.createView(),
      });

      if (sampler) {
        bindings.push({
          binding: 4,
          resource: sampler,
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
