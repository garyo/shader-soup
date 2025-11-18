/**
 * Post Processor - Apply brightness and contrast adjustments
 */

import type { Dimensions } from '@/types/core';
import type { WebGPUContext } from '../engine/WebGPUContext';
import { BufferManager } from '../engine/BufferManager';

export class PostProcessor {
  private context: WebGPUContext;
  private bufferManager: BufferManager;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  constructor(context: WebGPUContext, bufferManager: BufferManager) {
    this.context = context;
    this.bufferManager = bufferManager;
  }

  /**
   * Apply gamma and contrast adjustments to a buffer (in linear RGB space)
   * @param inputBuffer - Input buffer with vec4<f32> colors (linear RGB)
   * @param dimensions - Buffer dimensions
   * @param gamma - Gamma adjustment (0.1 to 10, default 1)
   * @param contrast - Contrast adjustment (-1 to 1, default 0)
   * @returns Output buffer with adjustments applied (still in linear RGB)
   */
  public async applyGammaContrast(
    inputBuffer: GPUBuffer,
    dimensions: Dimensions,
    gamma: number,
    contrast: number
  ): Promise<GPUBuffer> {
    const device = this.context.getDevice();
    const { width, height } = dimensions;

    // Always process to ensure consistent buffer handling
    // Create output buffer
    const outputSize = width * height * 4 * 4; // vec4<f32> = 16 bytes per pixel
    const outputBuffer = this.bufferManager.createBuffer(
      {
        size: outputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        label: 'post-process-output',
      },
      false
    );

    // Create or reuse pipeline
    if (!this.pipeline) {
      this.createPipeline();
    }

    // Create uniforms buffer with proper types (u32 for width/height, f32 for gamma/contrast)
    const uniformsBuffer = device.createBuffer({
      label: 'post-process-uniforms',
      size: 16, // 2 u32 + 2 f32 = 16 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write u32 values for width and height
    const dimensionsData = new Uint32Array([width, height]);
    device.queue.writeBuffer(uniformsBuffer, 0, dimensionsData);

    // Write f32 values for gamma and contrast
    const adjustmentsData = new Float32Array([gamma, contrast]);
    device.queue.writeBuffer(uniformsBuffer, 8, adjustmentsData); // offset by 8 bytes (2 u32s)

    // Create bind group
    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: uniformsBuffer } },
      ],
    });

    // Execute compute shader
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline!);
    passEncoder.setBindGroup(0, bindGroup);

    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    // Wait for GPU work to complete
    await device.queue.onSubmittedWorkDone();

    return outputBuffer;
  }

  private createPipeline(): void {
    const device = this.context.getDevice();

    const shaderCode = `
      struct Uniforms {
        width: u32,
        height: u32,
        gamma: f32,
        contrast: f32,
      }

      @group(0) @binding(0) var<storage> input: array<vec4<f32>>;
      @group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        if (id.x >= uniforms.width || id.y >= uniforms.height) {
          return;
        }

        let index = id.y * uniforms.width + id.x;
        var color = input[index];

        // Apply gamma correction (in linear RGB space)
        // gamma > 1 brightens midtones, gamma < 1 darkens midtones
        if (abs(uniforms.gamma - 1.0) > 0.001) {
          let invGamma = 1.0 / uniforms.gamma;
          color = vec4<f32>(
            pow(max(color.r, 0.0), invGamma),
            pow(max(color.g, 0.0), invGamma),
            pow(max(color.b, 0.0), invGamma),
            color.a
          );
        }

        // Apply contrast: scale around midpoint (0.5 in linear space)
        if (abs(uniforms.contrast) > 0.001) {
          let contrastFactor = 1.0 + uniforms.contrast;
          color = vec4<f32>(
            (color.r - 0.5) * contrastFactor + 0.5,
            (color.g - 0.5) * contrastFactor + 0.5,
            (color.b - 0.5) * contrastFactor + 0.5,
            color.a
          );
        }

        // Clamp to valid range [0, 1]
        color = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0, 1.0, 1.0, color.a));

        output[index] = color;
      }
    `;

    const shaderModule = device.createShaderModule({
      label: 'post-process-shader',
      code: shaderCode,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'post-process-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.pipeline = device.createComputePipeline({
      label: 'post-process-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });
  }
}
