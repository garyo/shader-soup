/**
 * Result Renderer - Convert GPU output buffers to displayable images
 */

import { BufferManager } from '../engine/BufferManager';
import { WebGPUContext } from '../engine/WebGPUContext';
import type { Dimensions } from '@/types/core';
import conversionShaderSource from '@/shaders/utils/float-to-uint8.wgsl?raw';
import downsampleShaderSource from '@/shaders/utils/downsample.wgsl?raw';

export class ResultRenderer {
  private bufferManager: BufferManager;
  private context: WebGPUContext;
  private conversionPipeline: GPUComputePipeline | null = null;
  private conversionBindGroupLayout: GPUBindGroupLayout | null = null;
  private downsamplePipeline: GPUComputePipeline | null = null;
  private downsampleBindGroupLayout: GPUBindGroupLayout | null = null;

  constructor(bufferManager: BufferManager, context: WebGPUContext) {
    this.bufferManager = bufferManager;
    this.context = context;
    this.initializeConversionPipeline();
    this.initializeDownsamplePipeline();
  }

  /**
   * Initialize GPU-based f32-to-uint8 conversion pipeline
   */
  private initializeConversionPipeline(): void {
    const device = this.context.getDevice();

    // Compile conversion shader
    const shaderModule = device.createShaderModule({
      label: 'float-to-uint8-converter',
      code: conversionShaderSource,
    });

    // Create bind group layout
    this.conversionBindGroupLayout = device.createBindGroupLayout({
      label: 'conversion-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    // Create pipeline
    this.conversionPipeline = device.createComputePipeline({
      label: 'float-to-uint8-pipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.conversionBindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
  }

  /**
   * Initialize GPU-based downsampling pipeline
   */
  private initializeDownsamplePipeline(): void {
    const device = this.context.getDevice();

    // Compile downsample shader
    const shaderModule = device.createShaderModule({
      label: 'downsample-shader',
      code: downsampleShaderSource,
    });

    // Create bind group layout
    this.downsampleBindGroupLayout = device.createBindGroupLayout({
      label: 'downsample-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create pipeline
    this.downsamplePipeline = device.createComputePipeline({
      label: 'downsample-pipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.downsampleBindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
  }

  /**
   * Downsample image on GPU using box filter
   * @param sourceBuffer - Source buffer at higher resolution
   * @param sourceDimensions - Source dimensions
   * @param targetDimensions - Target dimensions
   * @param factor - Downsampling factor
   * @returns Downsampled GPU buffer
   */
  public downsample(
    sourceBuffer: GPUBuffer,
    sourceDimensions: Dimensions,
    targetDimensions: Dimensions,
    factor: number
  ): GPUBuffer {
    const device = this.context.getDevice();
    const pixelCount = targetDimensions.width * targetDimensions.height;

    // Create output buffer
    const outputBuffer = this.bufferManager.createBuffer(
      {
        size: pixelCount * 16, // vec4<f32> = 16 bytes per pixel
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        label: 'downsampled-output',
      },
      false
    );

    if (!this.downsamplePipeline || !this.downsampleBindGroupLayout) {
      throw new Error('Downsample pipeline not initialized');
    }

    // Create params buffer
    const params = new Uint32Array([
      sourceDimensions.width,
      sourceDimensions.height,
      targetDimensions.width,
      targetDimensions.height,
      factor,
    ]);
    const paramsBuffer = this.bufferManager.createBufferWithData(
      params as BufferSource,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'downsample-params'
    );

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'downsample-bind-group',
      layout: this.downsampleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sourceBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });

    // Execute downsampling
    const encoder = device.createCommandEncoder({ label: 'downsample-encoder' });
    const pass = encoder.beginComputePass({ label: 'downsample-pass' });
    pass.setPipeline(this.downsamplePipeline);
    pass.setBindGroup(0, bindGroup);

    // Dispatch: 8x8 workgroups
    const workgroupsX = Math.ceil(targetDimensions.width / 8);
    const workgroupsY = Math.ceil(targetDimensions.height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();

    device.queue.submit([encoder.finish()]);

    return outputBuffer;
  }

  /**
   * Convert vec4<f32> buffer to RGBA8 buffer using GPU
   * @param f32Buffer - Input buffer with vec4<f32> data
   * @param dimensions - Image dimensions
   * @returns GPU buffer with packed RGBA8 data (u32 array)
   */
  public convertF32ToRGBA8(f32Buffer: GPUBuffer, dimensions: Dimensions): GPUBuffer {
    const device = this.context.getDevice();
    const pixelCount = dimensions.width * dimensions.height;

    // Create output buffer (4 bytes per pixel as packed u32)
    const outputBuffer = this.bufferManager.createBuffer(
      {
        size: pixelCount * 4, // 4 bytes per pixel
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        label: 'rgba8-output',
      },
      false
    );

    if (!this.conversionPipeline || !this.conversionBindGroupLayout) {
      throw new Error('Conversion pipeline not initialized');
    }

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'conversion-bind-group',
      layout: this.conversionBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: f32Buffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
    });

    // Execute conversion
    const encoder = device.createCommandEncoder({ label: 'conversion-encoder' });
    const pass = encoder.beginComputePass({ label: 'conversion-pass' });
    pass.setPipeline(this.conversionPipeline);
    pass.setBindGroup(0, bindGroup);

    // Dispatch: Use 2D dispatch to avoid exceeding workgroup limits
    // Workgroup size is 8x8 = 64 threads
    const workgroupsX = Math.ceil(dimensions.width / 8);
    const workgroupsY = Math.ceil(dimensions.height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();

    device.queue.submit([encoder.finish()]);

    return outputBuffer;
  }

  /**
   * Convert GPU buffer to ImageData using GPU-based conversion
   * @param buffer - GPU buffer containing RGBA data as vec4<f32>
   * @param dimensions - Image dimensions
   * @returns ImageData
   */
  public async bufferToImageData(buffer: GPUBuffer, dimensions: Dimensions): Promise<ImageData> {
    // Convert on GPU: vec4<f32> -> packed RGBA8
    const rgba8Buffer = this.convertF32ToRGBA8(buffer, dimensions);

    // Read packed RGBA8 data (4 bytes per pixel, already in correct format)
    const data = await this.bufferManager.readFromBuffer(rgba8Buffer);

    // Create Uint8ClampedArray view directly (no conversion needed!)
    const uint8Data = new Uint8ClampedArray(data);

    // Create ImageData
    return new ImageData(uint8Data, dimensions.width, dimensions.height);
  }

  /**
   * Create a data URL from GPU buffer
   * @param buffer - GPU buffer containing RGBA data
   * @param dimensions - Image dimensions
   * @param format - Image format (default: 'image/png')
   * @param quality - Image quality for JPEG (0-1, default: 0.92)
   * @returns Data URL
   */
  public async bufferToDataURL(
    buffer: GPUBuffer,
    dimensions: Dimensions,
    format: string = 'image/png',
    quality: number = 0.92
  ): Promise<string> {
    const imageData = await this.bufferToImageData(buffer, dimensions);

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL(format, quality);
  }

  /**
   * Download image from GPU buffer
   * @param buffer - GPU buffer containing RGBA data
   * @param dimensions - Image dimensions
   * @param filename - Download filename
   * @param format - Image format (default: 'image/png')
   */
  public async downloadImage(
    buffer: GPUBuffer,
    dimensions: Dimensions,
    filename: string,
    format: string = 'image/png'
  ): Promise<void> {
    const dataURL = await this.bufferToDataURL(buffer, dimensions, format);

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    link.click();
  }

}
