/**
 * Coordinate Generator - Generate normalized coordinate grids and textures
 */

import type { Dimensions } from '@/types/core';
import type { WebGPUContext } from '../engine/WebGPUContext';

/**
 * Coordinate system:
 * - X: -1.0 (left) to 1.0 (right)
 * - Y: Aspect-ratio scaled, centered at 0.0
 * - Origin: Center of image (0, 0)
 */
export class CoordinateGenerator {
  /**
   * Generate normalized coordinate grid
   * @param dimensions - Output dimensions
   * @returns Float32Array with interleaved x,y coordinates
   */
  public generateGrid(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;

        // Normalize X to -1 to 1
        const normalizedX = (x / (width - 1)) * 2 - 1;

        // Normalize Y to maintain aspect ratio, centered at 0
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        coords[index] = normalizedX;
        coords[index + 1] = normalizedY;
      }
    }

    return coords;
  }

  /**
   * Normalize a single coordinate pair
   * @param x - Pixel x coordinate
   * @param y - Pixel y coordinate
   * @param dimensions - Image dimensions
   * @returns Normalized [x, y] coordinates
   */
  public normalizeCoordinates(x: number, y: number, dimensions: Dimensions): [number, number] {
    const { width, height } = dimensions;
    const aspectRatio = width / height;

    const normalizedX = (x / (width - 1)) * 2 - 1;
    const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

    return [normalizedX, normalizedY];
  }

  /**
   * Denormalize coordinates back to pixel coordinates
   * @param normalizedX - Normalized x (-1 to 1)
   * @param normalizedY - Normalized y (aspect-ratio scaled)
   * @param dimensions - Image dimensions
   * @returns Pixel [x, y] coordinates
   */
  public denormalizeCoordinates(
    normalizedX: number,
    normalizedY: number,
    dimensions: Dimensions
  ): [number, number] {
    const { width, height } = dimensions;
    const aspectRatio = width / height;

    const x = ((normalizedX + 1) / 2) * (width - 1);
    const y = ((normalizedY * aspectRatio + 1) / 2) * (height - 1);

    return [x, y];
  }

  /**
   * Get coordinate at specific pixel
   * @param x - Pixel x coordinate
   * @param y - Pixel y coordinate
   * @param coords - Coordinate grid
   * @param width - Image width
   * @returns [x, y] coordinates
   */
  public getCoordinateAt(x: number, y: number, coords: Float32Array, width: number): [number, number] {
    const index = (y * width + x) * 2;
    return [coords[index], coords[index + 1]];
  }

  /**
   * Generate polar coordinates (r, theta)
   * @param dimensions - Output dimensions
   * @returns Float32Array with interleaved r, theta coordinates
   */
  public generatePolarGrid(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;

        // Get normalized coordinates
        const normalizedX = (x / (width - 1)) * 2 - 1;
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        // Convert to polar
        const r = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        const theta = Math.atan2(normalizedY, normalizedX);

        coords[index] = r;
        coords[index + 1] = theta;
      }
    }

    return coords;
  }

  /**
   * Get the bounds of the normalized coordinate system
   * @param dimensions - Image dimensions
   * @returns Bounds { minX, maxX, minY, maxY }
   */
  public getBounds(dimensions: Dimensions): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const aspectRatio = dimensions.width / dimensions.height;

    return {
      minX: -1.0,
      maxX: 1.0,
      minY: -1.0 / aspectRatio,
      maxY: 1.0 / aspectRatio,
    };
  }

  /**
   * Create a coordinate grid with a custom mapping function
   * @param dimensions - Output dimensions
   * @param mappingFn - Function to map pixel coords to custom coords
   * @returns Float32Array with custom coordinates
   */
  public generateCustomGrid(
    dimensions: Dimensions,
    mappingFn: (x: number, y: number, width: number, height: number) => [number, number]
  ): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;
        const [mappedX, mappedY] = mappingFn(x, y, width, height);

        coords[index] = mappedX;
        coords[index + 1] = mappedY;
      }
    }

    return coords;
  }

  /**
   * Calculate distance from center for each coordinate
   * @param dimensions - Image dimensions
   * @returns Float32Array with distances
   */
  public generateDistanceField(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const distances = new Float32Array(width * height);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;

        const normalizedX = (x / (width - 1)) * 2 - 1;
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        distances[index] = distance;
      }
    }

    return distances;
  }

  /**
   * Create a GPU texture containing normalized coordinates
   * GPU-side generation using compute shader with f16 support
   * @param dimensions - Texture dimensions
   * @param context - WebGPU context
   * @returns GPU texture with rgba16float format containing (x, y) coords
   */
  public createCoordinateTexture(dimensions: Dimensions, context: WebGPUContext): GPUTexture {
    const device = context.getDevice();
    const { width, height } = dimensions;

    // Create compute shader that generates f16 coordinates on GPU
    const shaderCode = `
      enable f16;

      struct Dimensions {
        width: u32,
        height: u32,
      }

      @group(0) @binding(0) var<storage, read_write> coords: array<vec4<f16>>;
      @group(0) @binding(1) var<uniform> dims: Dimensions;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        if (id.x >= dims.width || id.y >= dims.height) {
          return;
        }

        let index = id.y * dims.width + id.x;
        let aspectRatio = f32(dims.width) / f32(dims.height);

        // Normalize X to -1 to 1
        let normalizedX = (f32(id.x) / f32(dims.width - 1u)) * 2.0 - 1.0;

        // Normalize Y to maintain aspect ratio, centered at 0
        let normalizedY = ((f32(id.y) / f32(dims.height - 1u)) * 2.0 - 1.0) / aspectRatio;

        coords[index] = vec4<f16>(f16(normalizedX), f16(normalizedY), f16(0.0), f16(1.0));
      }
    `;

    const shaderModule = device.createShaderModule({
      label: 'coord-generator-f16',
      code: shaderCode,
    });

    // Create storage buffer for f16 coordinates
    const coordBufferSize = width * height * 4 * 2; // vec4<f16> = 8 bytes
    const coordBuffer = device.createBuffer({
      label: 'coord-buffer-f16',
      size: coordBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create dimensions uniform
    const dimsData = new Uint32Array([width, height]);
    const dimsBuffer = device.createBuffer({
      label: 'dims-uniform',
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(dimsBuffer, 0, dimsData);

    // Create bind group layout and bind group
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: coordBuffer } },
        { binding: 1, resource: { buffer: dimsBuffer } },
      ],
    });

    // Create pipeline
    const pipeline = device.createComputePipeline({
      label: 'coord-generator-pipeline-f16',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Execute compute shader to generate f16 coordinates
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    const workgroupsX = Math.ceil(width / 8);
    const workgroupsY = Math.ceil(height / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY);
    passEncoder.end();

    // Create texture
    const texture = device.createTexture({
      label: 'coordinate-texture',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Copy f16 buffer to texture (f16 → f16, no conversion)
    const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
    commandEncoder.copyBufferToTexture(
      { buffer: coordBuffer, bytesPerRow },
      { texture },
      { width, height }
    );

    device.queue.submit([commandEncoder.finish()]);

    return texture;
  }

  /**
   * Create a sampler with mirror addressing mode
   * @param context - WebGPU context
   * @returns GPU sampler with mirror-repeat mode and linear filtering
   */
  public createCoordinateSampler(context: WebGPUContext): GPUSampler {
    const device = context.getDevice();

    return device.createSampler({
      label: 'coordinate-sampler',
      addressModeU: 'mirror-repeat',
      addressModeV: 'mirror-repeat',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }
}
