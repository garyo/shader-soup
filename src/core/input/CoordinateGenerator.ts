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
   * @param zoom - Zoom factor (default 1.0, >1 zooms out, <1 zooms in)
   * @param panX - Pan offset in X direction (default 0)
   * @param panY - Pan offset in Y direction (default 0)
   * @returns GPU texture with rgba16float format containing (x, y) coords
   */
  public async createCoordinateTexture(
    dimensions: Dimensions,
    context: WebGPUContext,
    zoom: number = 1.0,
    panX: number = 0.0,
    panY: number = 0.0
  ): Promise<GPUTexture> {
    const device = context.getDevice();
    const { width, height } = dimensions;

    // Create compute shader that generates f16 coordinates on GPU
    const shaderCode = `
      enable f16;

      struct Dimensions {
        width: u32,
        height: u32,
      }

      struct Transform {
        zoom: f32,
        panX: f32,
        panY: f32,
        padding: f32,
      }

      @group(0) @binding(0) var<storage, read_write> coords: array<vec4<f16>>;
      @group(0) @binding(1) var<uniform> dims: Dimensions;
      @group(0) @binding(2) var<uniform> transform: Transform;

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

        // Apply zoom and pan transformations
        // Zoom: divide by zoom (zoom > 1 = zoom in, smaller coord range)
        // Pan: subtract pan (positive panX shifts view left, positive panY shifts view up)
        let transformedX = normalizedX / transform.zoom - transform.panX;
        let transformedY = normalizedY / transform.zoom + transform.panY;

        coords[index] = vec4<f16>(f16(transformedX), f16(transformedY), f16(0.0), f16(1.0));
      }
    `;

    const shaderModule = device.createShaderModule({
      label: 'coord-generator-f16',
      code: shaderCode,
    });

    // Check if we can use storage buffer or need to use texture directly
    const coordBufferSize = width * height * 4 * 2; // vec4<f16> = 8 bytes
    const maxStorageSize = device.limits.maxStorageBufferBindingSize;

    if (coordBufferSize > maxStorageSize) {
      console.log(`[CoordGen] Buffer size (${(coordBufferSize / 1024 / 1024).toFixed(0)}MB) exceeds limit (${(maxStorageSize / 1024 / 1024).toFixed(0)}MB), using CPU generation`);
      // Fall back to CPU generation for very large textures
      return this.createCoordinateTextureCPU(dimensions, context, zoom, panX, panY);
    }

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

    // Create transform uniform (zoom, panX, panY, padding)
    const transformData = new Float32Array([zoom, panX, panY, 0.0]);
    const transformBuffer = device.createBuffer({
      label: 'transform-uniform',
      size: 16, // 4 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(transformBuffer, 0, transformData);

    // Create bind group layout and bind group
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: coordBuffer } },
        { binding: 1, resource: { buffer: dimsBuffer } },
        { binding: 2, resource: { buffer: transformBuffer } },
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
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });

    // Copy f16 buffer to texture (f16 → f16, no conversion)
    const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
    commandEncoder.copyBufferToTexture(
      { buffer: coordBuffer, bytesPerRow },
      { texture },
      { width, height }
    );

    device.queue.submit([commandEncoder.finish()]);

    // IMPORTANT: Wait for GPU to finish generating coordinates before returning
    await device.queue.onSubmittedWorkDone();

    return texture;
  }

  /**
   * Create coordinate texture using CPU-side generation (fallback for large textures)
   * @param dimensions - Texture dimensions
   * @param context - WebGPU context
   * @param zoom - Zoom factor
   * @param panX - Pan offset in X
   * @param panY - Pan offset in Y
   * @returns GPU texture with rgba16float format
   */
  private async createCoordinateTextureCPU(
    dimensions: Dimensions,
    context: WebGPUContext,
    zoom: number = 1.0,
    panX: number = 0.0,
    panY: number = 0.0
  ): Promise<GPUTexture> {
    const device = context.getDevice();
    const { width, height } = dimensions;

    // Create Float32Array for coordinates (we'll convert to f16 via writeTexture)
    const coords = new Float32Array(width * height * 4);
    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;

        // Normalize X to -1 to 1
        const normalizedX = (x / (width - 1)) * 2 - 1;

        // Normalize Y to maintain aspect ratio, centered at 0
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        // Apply zoom and pan
        const transformedX = normalizedX / zoom - panX;
        const transformedY = normalizedY / zoom + panY;

        coords[index] = transformedX;
        coords[index + 1] = transformedY;
        coords[index + 2] = 0.0;
        coords[index + 3] = 1.0;
      }
    }

    // Create texture
    const texture = device.createTexture({
      label: 'coordinate-texture-cpu',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });

    // Write data to texture in chunks to avoid maxBufferSize limit
    // bytesPerRow for Float32Array: width * 4 channels * 4 bytes = width * 16
    const bytesPerRow = Math.ceil((width * 16) / 256) * 256;
    const maxChunkSize = 64 * 1024 * 1024; // 64MB chunks to stay well under limits
    const rowsPerChunk = Math.floor(maxChunkSize / bytesPerRow);
    const numChunks = Math.ceil(height / rowsPerChunk);

    console.log(`[CoordGen CPU] Writing ${width}x${height} texture in ${numChunks} chunks`);

    // Push error scopes for texture writing
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');

    for (let startRow = 0; startRow < height; startRow += rowsPerChunk) {
      const rowsThisChunk = Math.min(rowsPerChunk, height - startRow);
      const offsetInFloats = startRow * width * 4;
      const sizeInFloats = rowsThisChunk * width * 4;
      const chunkData = coords.subarray(offsetInFloats, offsetInFloats + sizeInFloats);

      device.queue.writeTexture(
        { texture, origin: { x: 0, y: startRow, z: 0 } },
        chunkData,
        { bytesPerRow },
        { width, height: rowsThisChunk, depthOrArrayLayers: 1 }
      );
    }

    await device.queue.onSubmittedWorkDone();

    // Check for errors during texture writing
    const memError = await device.popErrorScope();
    if (memError) {
      throw new Error(`GPU out-of-memory writing coordinate texture: ${memError.message}`);
    }
    const valError = await device.popErrorScope();
    if (valError) {
      throw new Error(`GPU validation error writing coordinate texture: ${valError.message}`);
    }

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
