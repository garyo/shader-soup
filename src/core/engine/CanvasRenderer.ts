/**
 * Canvas Renderer - Direct GPU-to-Canvas rendering without CPU readback
 * Handles texture-to-canvas rendering with format conversion and downsampling
 */

import type { WebGPUContext } from './WebGPUContext';

export class CanvasRenderer {
  private context: WebGPUContext;
  private canvasContext: GPUCanvasContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private initialized: boolean = false;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Initialize the display pipeline (loads shader)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const device = this.context.getDevice();

    // Load display shader
    const response = await fetch('/src/shaders/utils/display.wgsl');
    const shaderCode = await response.text();

    const shaderModule = device.createShaderModule({
      label: 'display-shader',
      code: shaderCode,
    });

    // Create sampler with trilinear filtering for mipmapped textures
    // Automatically selects correct mip level based on texture:canvas size ratio
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear', // Trilinear filtering (interpolates between mip levels)
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create render pipeline
    this.renderPipeline = device.createRenderPipeline({
      label: 'display-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.context.getCanvasFormat() as GPUTextureFormat,
        }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    this.initialized = true;
  }

  /**
   * Configure a canvas for WebGPU rendering
   * @param canvas - Canvas element to configure
   */
  public configureCanvas(canvas: HTMLCanvasElement): void {
    // Only configure if not already configured for this canvas
    if (this.canvas === canvas && this.canvasContext) {
      return; // Already configured
    }

    this.canvas = canvas;
    this.canvasContext = this.context.configureCanvas(canvas);
  }

  /**
   * Configure with an already-configured GPUCanvasContext (for OffscreenCanvas)
   * @param canvasContext - Pre-configured GPU canvas context
   */
  public configureCanvasContext(canvasContext: GPUCanvasContext): void {
    this.canvasContext = canvasContext;
    this.canvas = null; // No HTMLCanvasElement for OffscreenCanvas
  }

  /**
   * Render a texture directly to the configured canvas (GPU-only, zero CPU readback)
   * Uses linear filtering for automatic downsampling if canvas size differs from texture
   * @param sourceTexture - Source texture (rgba32float from compute shader)
   */
  public async renderToCanvas(sourceTexture: GPUTexture): Promise<void> {
    if (!this.canvasContext) {
      throw new Error('Canvas not configured. Call configureCanvas() or configureCanvasContext() first.');
    }

    await this.initialize();

    const device = this.context.getDevice();

    // Get current canvas texture
    const canvasTexture = this.canvasContext.getCurrentTexture();

    // Create bind group for this frame
    const bindGroup = device.createBindGroup({
      label: 'display-bind-group',
      layout: this.renderPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.sampler! },
      ],
    });

    // Render to canvas
    const encoder = device.createCommandEncoder({ label: 'canvas-render' });
    const renderPass = encoder.beginRenderPass({
      label: 'display-render-pass',
      colorAttachments: [{
        view: canvasTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    renderPass.setPipeline(this.renderPipeline!);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3); // Fullscreen triangle

    renderPass.end();

    // Submit and wait
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }

  /**
   * Get the canvas element
   */
  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Check if canvas is configured
   */
  public isConfigured(): boolean {
    return this.canvasContext !== null && this.canvas !== null;
  }

  /**
   * Resize the canvas (call this when window resizes)
   */
  public resize(width: number, height: number): void {
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
