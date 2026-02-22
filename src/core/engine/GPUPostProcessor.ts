/**
 * GPU Post-Processor - Applies gamma/contrast adjustments on GPU without CPU readback
 */

import type { WebGPUContext } from './WebGPUContext';
import type { ShaderCompiler } from './ShaderCompiler';
import type { BufferManager } from './BufferManager';
import gammaContrastShaderSource from '../../shaders/utils/gamma-contrast.wgsl?raw';
import mipmapBlitShaderSource from '../../shaders/utils/mipmap-blit.wgsl?raw';

export class GPUPostProcessor {
  private context: WebGPUContext;
  private compiler: ShaderCompiler;
  private pipeline: GPUComputePipeline | null = null;
  private shaderModule: GPUShaderModule | null = null;
  private initialized: boolean = false;

  // Texture pool for double-buffering (prevents flashing during parameter changes)
  private texturePool: Map<string, GPUTexture> = new Map();

  // Display texture pool - filterable textures with mipmaps for antialiased display
  private displayTexturePool: Map<string, GPUTexture> = new Map();

  // Mipmap generation pipeline
  private mipmapPipeline: GPURenderPipeline | null = null;
  private mipmapSampler: GPUSampler | null = null;

  // Cached uniform buffers (reused every frame)
  private dimensionsBuffer: GPUBuffer | null = null;
  private paramsBuffer: GPUBuffer | null = null;

  // Cached bind group (recreated only when input/output textures change)
  private cachedBindGroup: GPUBindGroup | null = null;
  private cachedBindGroupKey: string = '';

  // Reusable typed arrays for writing to buffers
  private dimensionsData = new Uint32Array(2);
  private paramsData = new Float32Array(2);

  constructor(
    context: WebGPUContext,
    compiler: ShaderCompiler,
    _bufferManager: BufferManager
  ) {
    this.context = context;
    this.compiler = compiler;
  }

  /**
   * Initialize the GPU post-processor (loads and compiles shader)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const device = this.context.getDevice();
    const displayFormat = this.context.getDisplayStorageFormat();

    // Gamma-contrast shader (imported at build time)
    let shaderSource = gammaContrastShaderSource;

    // Replace format placeholder with actual display format
    shaderSource = shaderSource.replace(/rgba16float/g, displayFormat);

    // Compile shader
    const result = await this.compiler.compile(shaderSource, 'gpu-post-processor');
    if (!result.success || !result.module) {
      throw new Error('Failed to compile GPU post-processing shader');
    }

    this.shaderModule = result.module;

    // Create bind group layout
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
            format: displayFormat,
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

    // Pre-allocate uniform buffers (reused every frame via writeBuffer)
    this.dimensionsBuffer = device.createBuffer({
      size: 8, // 2 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'post-processor-dimensions',
    });

    this.paramsBuffer = device.createBuffer({
      size: 8, // 2 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'post-processor-params',
    });

    this.initialized = true;
  }

  /**
   * Apply gamma and contrast adjustments on GPU
   * @param shaderId - Shader ID for texture pooling
   * @param inputTexture - Input texture (rgba32float from compute shader)
   * @param dimensions - Texture dimensions
   * @param gamma - Gamma value (1.0 = no change)
   * @param contrast - Contrast value (1.0 = no change)
   * @returns Object with storage texture (for ImageData) and display texture (for WebGPU rendering)
   */
  public async applyGammaContrast(
    shaderId: string,
    inputTexture: GPUTexture,
    dimensions: { width: number; height: number },
    gamma: number,
    contrast: number
  ): Promise<{ storageTexture: GPUTexture; displayTexture: GPUTexture }> {
    if (!this.initialized || !this.pipeline) {
      await this.initialize();
    }

    const device = this.context.getDevice();
    const displayFormat = this.context.getDisplayStorageFormat();

    // Get or create output texture from pool (prevents flashing during parameter changes)
    const poolKey = `${shaderId}-${dimensions.width}x${dimensions.height}`;
    let outputTexture = this.texturePool.get(poolKey);

    if (!outputTexture) {
      outputTexture = device.createTexture({
        size: { width: dimensions.width, height: dimensions.height },
        format: displayFormat,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        label: `post-processed-output-${shaderId}`,
      });
      this.texturePool.set(poolKey, outputTexture);
    }

    // Update uniform buffers in-place (no allocation)
    this.dimensionsData[0] = dimensions.width;
    this.dimensionsData[1] = dimensions.height;
    device.queue.writeBuffer(this.dimensionsBuffer!, 0, this.dimensionsData);

    this.paramsData[0] = gamma;
    this.paramsData[1] = contrast;
    device.queue.writeBuffer(this.paramsBuffer!, 0, this.paramsData);

    // Recreate bind group only when input/output textures change
    const bindGroupKey = `${inputTexture.label}:${poolKey}`;
    if (this.cachedBindGroupKey !== bindGroupKey) {
      this.cachedBindGroup = device.createBindGroup({
        label: 'gpu-post-processor-bind-group',
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: inputTexture.createView() },
          { binding: 1, resource: outputTexture.createView() },
          { binding: 2, resource: { buffer: this.dimensionsBuffer! } },
          { binding: 3, resource: { buffer: this.paramsBuffer! } },
        ],
      });
      this.cachedBindGroupKey = bindGroupKey;
    }

    // Create filterable display texture with mipmaps (for antialiased rendering)
    const displayPoolKey = `display-${poolKey}`;
    const mipLevelCount = 4;

    let displayTexture = this.displayTexturePool.get(displayPoolKey);

    // Check if pooled texture has wrong mip count (from previous runs)
    if (displayTexture && displayTexture.mipLevelCount !== mipLevelCount) {
      displayTexture.destroy();
      this.displayTexturePool.delete(displayPoolKey);
      displayTexture = undefined;
    }

    if (!displayTexture) {
      displayTexture = device.createTexture({
        size: { width: dimensions.width, height: dimensions.height },
        format: displayFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount,
        label: `display-texture-${shaderId}`,
      });
      this.displayTexturePool.set(displayPoolKey, displayTexture);
    }

    // Batch all work into a single command encoder + submit:
    // 1. Post-process compute dispatch
    // 2. Copy storage texture to display texture (mip 0)
    const encoder = device.createCommandEncoder({ label: 'gpu-post-processor-batch' });

    // 1. Post-process compute pass
    const pass = encoder.beginComputePass({ label: 'gpu-post-processor-pass' });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.cachedBindGroup!);
    const workgroupsX = Math.ceil(dimensions.width / 8);
    const workgroupsY = Math.ceil(dimensions.height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();

    // 2. Copy to display texture (mip 0)
    encoder.copyTextureToTexture(
      { texture: outputTexture },
      { texture: displayTexture, mipLevel: 0 },
      { width: dimensions.width, height: dimensions.height }
    );

    device.queue.submit([encoder.finish()]);

    // 3. Generate mipmaps (single submit internally)
    this.generateMipmaps(device, displayTexture);

    return {
      storageTexture: outputTexture,
      displayTexture: displayTexture,
    };
  }

  /**
   * Initialize mipmap generation pipeline
   */
  private async initMipmapPipeline(): Promise<void> {
    if (this.mipmapPipeline) {
      return;
    }

    const device = this.context.getDevice();

    // Mipmap blit shader (imported at build time)
    const shaderCode = mipmapBlitShaderSource;
    const shaderModule = device.createShaderModule({
      label: 'mipmap-blit-shader',
      code: shaderCode,
    });

    // Create sampler for downsampling
    this.mipmapSampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
    });

    // Create render pipeline
    this.mipmapPipeline = device.createRenderPipeline({
      label: 'mipmap-blit-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.context.getDisplayStorageFormat() as GPUTextureFormat,
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  /**
   * Generate mipmaps for a texture (for antialiased downsampling)
   */
  private generateMipmaps(
    device: GPUDevice,
    texture: GPUTexture
  ): void {
    if (!this.mipmapPipeline) {
      // Pipeline not ready yet - skip mipmaps this frame
      // (initMipmapPipeline is async, but we don't want to await in hot path)
      this.initMipmapPipeline();
      return;
    }

    const mipLevelCount = texture.mipLevelCount;
    const encoder = device.createCommandEncoder({ label: 'generate-mipmaps' });

    for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel++) {
      const bindGroup = device.createBindGroup({
        label: `mipmap-bind-group-${mipLevel}`,
        layout: this.mipmapPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: mipLevel - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.mipmapSampler! },
        ],
      });

      const renderPass = encoder.beginRenderPass({
        label: `mip-level-${mipLevel}`,
        colorAttachments: [{
          view: texture.createView({ baseMipLevel: mipLevel, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });

      renderPass.setPipeline(this.mipmapPipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3);
      renderPass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  /**
   * Clear texture pool for a specific shader (call when shader is deleted)
   */
  public clearShaderTextures(shaderId: string): void {
    for (const [key, texture] of this.texturePool.entries()) {
      if (key.startsWith(`${shaderId}-`)) {
        texture.destroy();
        this.texturePool.delete(key);
      }
    }
    for (const [key, texture] of this.displayTexturePool.entries()) {
      if (key.startsWith(`display-${shaderId}-`)) {
        texture.destroy();
        this.displayTexturePool.delete(key);
      }
    }
    // Invalidate cached bind group if it referenced this shader's textures
    if (this.cachedBindGroupKey.includes(shaderId)) {
      this.cachedBindGroup = null;
      this.cachedBindGroupKey = '';
    }
  }

  /**
   * Clear all pooled textures
   */
  public clearAll(): void {
    for (const texture of this.texturePool.values()) {
      texture.destroy();
    }
    this.texturePool.clear();

    for (const texture of this.displayTexturePool.values()) {
      texture.destroy();
    }
    this.displayTexturePool.clear();

    this.cachedBindGroup = null;
    this.cachedBindGroupKey = '';
  }
}
