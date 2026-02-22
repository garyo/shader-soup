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
  private cachedInputTexture: GPUTexture | null = null;
  private cachedOutputPoolKey: string = '';

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
   * @param computeDimensions - Dimensions of the compute/storage texture (supersampled resolution)
   * @param displayDimensions - Dimensions of the display texture (output resolution, may be smaller)
   * @param gamma - Gamma value (1.0 = no change)
   * @param contrast - Contrast value (1.0 = no change)
   * @returns Object with storage texture and display texture (for WebGPU rendering)
   */
  public async applyGammaContrast(
    shaderId: string,
    inputTexture: GPUTexture,
    computeDimensions: { width: number; height: number },
    displayDimensions: { width: number; height: number },
    gamma: number,
    contrast: number
  ): Promise<{ storageTexture: GPUTexture; displayTexture: GPUTexture }> {
    if (!this.initialized || !this.pipeline) {
      await this.initialize();
    }

    const device = this.context.getDevice();
    const displayFormat = this.context.getDisplayStorageFormat();

    // Get or create storage texture from pool at compute (supersampled) resolution
    const poolKey = `${shaderId}-${computeDimensions.width}x${computeDimensions.height}`;
    let outputTexture = this.texturePool.get(poolKey);

    if (!outputTexture) {
      outputTexture = device.createTexture({
        size: { width: computeDimensions.width, height: computeDimensions.height },
        format: displayFormat,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        label: `post-processed-output-${shaderId}`,
      });
      this.texturePool.set(poolKey, outputTexture);
    }

    // Update uniform buffers in-place (no allocation)
    this.dimensionsData[0] = computeDimensions.width;
    this.dimensionsData[1] = computeDimensions.height;
    device.queue.writeBuffer(this.dimensionsBuffer!, 0, this.dimensionsData);

    this.paramsData[0] = gamma;
    this.paramsData[1] = contrast;
    device.queue.writeBuffer(this.paramsBuffer!, 0, this.paramsData);

    // Recreate bind group only when input/output textures change
    if (this.cachedInputTexture !== inputTexture || this.cachedOutputPoolKey !== poolKey) {
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
      this.cachedInputTexture = inputTexture;
      this.cachedOutputPoolKey = poolKey;
    }

    // Create filterable display texture with mipmaps at output resolution
    const displayPoolKey = `display-${shaderId}-${displayDimensions.width}x${displayDimensions.height}`;
    const mipLevelCount = Math.floor(Math.log2(Math.max(displayDimensions.width, displayDimensions.height))) + 1;

    let displayTexture = this.displayTexturePool.get(displayPoolKey);

    // Check if pooled texture has wrong mip count or dimensions
    if (displayTexture && (displayTexture.mipLevelCount !== mipLevelCount ||
        displayTexture.width !== displayDimensions.width ||
        displayTexture.height !== displayDimensions.height)) {
      displayTexture.destroy();
      this.displayTexturePool.delete(displayPoolKey);
      displayTexture = undefined;
    }

    if (!displayTexture) {
      displayTexture = device.createTexture({
        size: { width: displayDimensions.width, height: displayDimensions.height },
        format: displayFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount,
        label: `display-texture-${shaderId}`,
      });
      this.displayTexturePool.set(displayPoolKey, displayTexture);
    }

    // Batch compute dispatch into a single command encoder
    const encoder = device.createCommandEncoder({ label: 'gpu-post-processor-batch' });

    // 1. Post-process compute pass (runs at compute/supersampled resolution)
    const pass = encoder.beginComputePass({ label: 'gpu-post-processor-pass' });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.cachedBindGroup!);
    const workgroupsX = Math.ceil(computeDimensions.width / 8);
    const workgroupsY = Math.ceil(computeDimensions.height / 8);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();

    // 2. Downsample storage texture → display texture mip 0
    if (computeDimensions.width === displayDimensions.width &&
        computeDimensions.height === displayDimensions.height) {
      // Same size: simple copy
      encoder.copyTextureToTexture(
        { texture: outputTexture },
        { texture: displayTexture, mipLevel: 0 },
        { width: displayDimensions.width, height: displayDimensions.height }
      );
      device.queue.submit([encoder.finish()]);
    } else {
      // Different sizes: submit compute first, then downsample via render pass with linear filtering
      device.queue.submit([encoder.finish()]);
      this.downsampleToDisplay(device, outputTexture, displayTexture);
    }

    // 3. Generate mipmaps from mip 0 (single submit internally)
    this.generateMipmaps(device, displayTexture);

    return {
      storageTexture: outputTexture,
      displayTexture: displayTexture,
    };
  }

  /**
   * Downsample a source texture into the mip 0 of a (smaller) destination texture
   * using a render pass with linear filtering.
   */
  private downsampleToDisplay(
    device: GPUDevice,
    source: GPUTexture,
    dest: GPUTexture
  ): void {
    if (!this.mipmapPipeline) {
      this.initMipmapPipeline();
      return;
    }

    const bindGroup = device.createBindGroup({
      label: 'downsample-to-display',
      layout: this.mipmapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 1, resource: this.mipmapSampler! },
      ],
    });

    const encoder = device.createCommandEncoder({ label: 'downsample-to-display' });
    const renderPass = encoder.beginRenderPass({
      label: 'downsample-to-display-pass',
      colorAttachments: [{
        view: dest.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    renderPass.setPipeline(this.mipmapPipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
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
   * Free storage texture for a shader (call after static render completes to save memory).
   * The storage texture will be recreated if the shader needs re-execution.
   */
  public freeStorageTexture(shaderId: string): void {
    for (const [key, texture] of this.texturePool.entries()) {
      if (key.startsWith(`${shaderId}-`)) {
        texture.destroy();
        this.texturePool.delete(key);
      }
    }
    // Invalidate cached bind group if it referenced this shader's textures
    if (this.cachedOutputPoolKey.startsWith(`${shaderId}-`)) {
      this.cachedBindGroup = null;
      this.cachedInputTexture = null;
      this.cachedOutputPoolKey = '';
    }
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
    if (this.cachedOutputPoolKey.includes(shaderId)) {
      this.cachedBindGroup = null;
      this.cachedInputTexture = null;
      this.cachedOutputPoolKey = '';
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
    this.cachedInputTexture = null;
    this.cachedOutputPoolKey = '';
  }
}
