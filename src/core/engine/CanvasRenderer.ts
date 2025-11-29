/**
 * Canvas Renderer - Direct GPU-to-Canvas rendering without CPU readback
 * Handles texture-to-canvas copies and format conversion
 */

import type { WebGPUContext } from './WebGPUContext';

export class CanvasRenderer {
  private context: WebGPUContext;
  private canvasContext: GPUCanvasContext | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Configure a canvas for WebGPU rendering
   * @param canvas - Canvas element to configure
   */
  public configureCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.canvasContext = this.context.configureCanvas(canvas);
  }

  /**
   * Render a texture directly to the configured canvas (GPU-only, zero CPU readback)
   * @param sourceTexture - Source texture (rgba32float from compute shader)
   * @param dimensions - Texture dimensions
   */
  public async renderToCanvas(
    sourceTexture: GPUTexture,
    dimensions: { width: number; height: number }
  ): Promise<void> {
    if (!this.canvasContext || !this.canvas) {
      throw new Error('Canvas not configured. Call configureCanvas() first.');
    }

    const device = this.context.getDevice();

    // Get current canvas texture
    const canvasTexture = this.canvasContext.getCurrentTexture();

    // Create command encoder for texture copy
    const encoder = device.createCommandEncoder({ label: 'canvas-render' });

    // Copy source texture to canvas texture
    // rgba32float (compute output) → rgba16float/rgba8unorm (canvas)
    encoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: canvasTexture },
      [dimensions.width, dimensions.height]
    );

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
