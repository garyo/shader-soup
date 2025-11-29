/**
 * GPU Post-Processor - Applies gamma/contrast adjustments on GPU without CPU readback
 */

import type { WebGPUContext } from './WebGPUContext';
import type { ShaderCompiler } from './ShaderCompiler';
import type { BufferManager } from './BufferManager';

export class GPUPostProcessor {
  private context: WebGPUContext;
  private compiler: ShaderCompiler;
  private bufferManager: BufferManager;
  private pipeline: GPUComputePipeline | null = null;
  private shaderModule: GPUShaderModule | null = null;
  private initialized: boolean = false;

  constructor(
    context: WebGPUContext,
    compiler: ShaderCompiler,
    bufferManager: BufferManager
  ) {
    this.context = context;
    this.compiler = compiler;
    this.bufferManager = bufferManager;
  }

  /**
   * Initialize the GPU post-processor (loads and compiles shader)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load gamma-contrast shader
    const shaderPath = '/src/shaders/utils/gamma-contrast.wgsl';
    const response = await fetch(shaderPath);
    const shaderSource = await response.text();

    // Compile shader
    const result = await this.compiler.compile(shaderSource, 'gpu-post-processor');
    if (!result.success || !result.module) {
      throw new Error('Failed to compile GPU post-processing shader');
    }

    this.shaderModule = result.module;

    // Create bind group layout
    const device = this.context.getDevice();
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'gpu-post-processor-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d' }, // rgba32float is unfilterable
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba32float',
            viewDimension: '2d',
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create pipeline
    this.pipeline = device.createComputePipeline({
      label: 'gpu-post-processor',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        module: this.shaderModule,
        entryPoint: 'main',
      },
    });

    this.initialized = true;
  }

  /**
   * Apply gamma and contrast adjustments on GPU
   * @param inputTexture - Input texture (rgba32float)
   * @param dimensions - Texture dimensions
   * @param gamma - Gamma value (1.0 = no change)
   * @param contrast - Contrast value (1.0 = no change)
   * @returns Output texture with adjustments applied (rgba32float)
   */
  public async applyGammaContrast(
    inputTexture: GPUTexture,
    dimensions: { width: number; height: number },
    gamma: number,
    contrast: number
  ): Promise<GPUTexture> {
    if (!this.initialized || !this.pipeline) {
      await this.initialize();
    }

    const device = this.context.getDevice();

    // Create output texture
    const outputTexture = device.createTexture({
      size: { width: dimensions.width, height: dimensions.height },
      format: 'rgba32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      label: 'post-processed-output',
    });

    // Create uniform buffers
    const dimensionsData = new Uint32Array([dimensions.width, dimensions.height]);
    const dimensionsBuffer = this.bufferManager.createBufferWithData(
      dimensionsData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'post-processor-dimensions'
    );

    const paramsData = new Float32Array([gamma, contrast]);
    const paramsBuffer = this.bufferManager.createBufferWithData(
      paramsData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'post-processor-params'
    );

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'gpu-post-processor-bind-group',
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: dimensionsBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });

    // Execute post-processing
    const encoder = device.createCommandEncoder({ label: 'gpu-post-processor-encoder' });
    const pass = encoder.beginComputePass({ label: 'gpu-post-processor-pass' });

    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);

    // Calculate workgroups
    const workgroupsX = Math.ceil(dimensions.width / 8);
    const workgroupsY = Math.ceil(dimensions.height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);

    pass.end();

    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    return outputTexture;
  }
}
