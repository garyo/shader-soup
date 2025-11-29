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

  // Texture pool for double-buffering (prevents flashing during parameter changes)
  private texturePool: Map<string, GPUTexture> = new Map();

  // Display texture pool - filterable textures with mipmaps for antialiased display
  private displayTexturePool: Map<string, GPUTexture> = new Map();

  // Mipmap generation pipeline
  private mipmapPipeline: GPURenderPipeline | null = null;
  private mipmapSampler: GPUSampler | null = null;

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

    const device = this.context.getDevice();
    const displayFormat = this.context.getDisplayStorageFormat();

    // Load gamma-contrast shader
    const shaderPath = '/src/shaders/utils/gamma-contrast.wgsl';
    const response = await fetch(shaderPath);
    let shaderSource = await response.text();

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

    // Create filterable display texture with mipmaps (for antialiased rendering)
    // Storage textures are unfilterable, so we need a separate texture for display
    const displayPoolKey = `display-${poolKey}`;

    // Use 4 mip levels for smoother 3× downsampling
    // Mip 0: 1536×1536, Mip 1: 768×768, Mip 2: 384×384, Mip 3: 192×192
    // For 512×512 display, GPU picks mip ~1.58 (interpolates between 768 and 384)
    const mipLevelCount = 4;

    let displayTexture = this.displayTexturePool.get(displayPoolKey);

    // Check if pooled texture has wrong mip count (from previous runs)
    if (displayTexture && displayTexture.mipLevelCount !== mipLevelCount) {
      console.log(`[GPUPostProcessor] Clearing pooled texture with wrong mip count (${displayTexture.mipLevelCount} → ${mipLevelCount})`);
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
      console.log(`[GPUPostProcessor] Created display texture with ${mipLevelCount} mip levels (${dimensions.width}×${dimensions.height} → ${dimensions.width/2}×${dimensions.height/2})`);
    }

    // Copy storage texture to filterable texture (mip level 0)
    const copyEncoder = device.createCommandEncoder({ label: 'copy-to-display-texture' });
    copyEncoder.copyTextureToTexture(
      { texture: outputTexture },
      { texture: displayTexture, mipLevel: 0 }, // Explicitly copy to mip 0
      { width: dimensions.width, height: dimensions.height }
    );
    device.queue.submit([copyEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    // Generate mipmaps for proper antialiased downsampling
    await this.generateMipmaps(device, displayTexture, dimensions);

    // Return both textures:
    // - storageTexture: rgba32float for ImageData generation (App.tsx expects this format)
    // - displayTexture: rgba16float filterable for WebGPU canvas rendering
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

    // Load mipmap blit shader
    const response = await fetch('/src/shaders/utils/mipmap-blit.wgsl');
    const shaderCode = await response.text();
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
  private async generateMipmaps(
    device: GPUDevice,
    texture: GPUTexture,
    dimensions: { width: number; height: number }
  ): Promise<void> {
    await this.initMipmapPipeline();

    // Use the texture's actual mip count, not recalculated from dimensions
    const mipLevelCount = texture.mipLevelCount;
    const encoder = device.createCommandEncoder({ label: 'generate-mipmaps' });

    // Generate each mip level by sampling from the previous level with linear filtering
    for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel++) {
      // Create bind group to sample from previous mip level
      const bindGroup = device.createBindGroup({
        label: `mipmap-bind-group-${mipLevel}`,
        layout: this.mipmapPipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: mipLevel - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.mipmapSampler! },
        ],
      });

      // Render to current mip level
      const renderPass = encoder.beginRenderPass({
        label: `mip-level-${mipLevel}`,
        colorAttachments: [{
          view: texture.createView({ baseMipLevel: mipLevel, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });

      renderPass.setPipeline(this.mipmapPipeline!);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3); // Fullscreen triangle

      renderPass.end();
    }

    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
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
  }
}
