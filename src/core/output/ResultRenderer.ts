/**
 * Result Renderer - Convert GPU output buffers to displayable images
 */

import { BufferManager } from '../engine/BufferManager';
import type { Dimensions } from '@/types/core';

export class ResultRenderer {
  private bufferManager: BufferManager;
  private useOffscreenCanvas: boolean;

  constructor(bufferManager: BufferManager) {
    this.bufferManager = bufferManager;
    this.useOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  }

  /**
   * Convert GPU buffer to ImageData
   * @param buffer - GPU buffer containing RGBA data as vec4<f32>
   * @param dimensions - Image dimensions
   * @returns ImageData
   */
  public async bufferToImageData(buffer: GPUBuffer, dimensions: Dimensions): Promise<ImageData> {
    // Read buffer data (contains f32 values: 4 bytes per channel, 16 bytes per pixel)
    const data = await this.bufferManager.readFromBuffer(buffer);

    // TODO: Optimize by doing f32-to-uint8 conversion on GPU using a compute shader
    // This would eliminate the CPU conversion loop and reduce data transfer
    // (vec4<f32> 16 bytes/pixel -> vec4<u8> 4 bytes/pixel)

    // Convert from Float32Array to Uint8ClampedArray
    const float32Data = new Float32Array(data);
    const pixelCount = dimensions.width * dimensions.height;
    const uint8Data = new Uint8ClampedArray(pixelCount * 4);

    // Convert f32 (0.0-1.0) to uint8 (0-255)
    for (let i = 0; i < pixelCount * 4; i++) {
      uint8Data[i] = Math.floor(float32Data[i] * 255);
    }

    // Create ImageData
    return new ImageData(uint8Data, dimensions.width, dimensions.height);
  }

  /**
   * Render GPU buffer to canvas
   * @param buffer - GPU buffer containing RGBA data
   * @param canvas - Target canvas element
   * @param dimensions - Image dimensions
   */
  public async renderToCanvas(
    buffer: GPUBuffer,
    canvas: HTMLCanvasElement,
    dimensions: Dimensions
  ): Promise<void> {
    const imageData = await this.bufferToImageData(buffer, dimensions);

    // Set canvas size if needed
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
    }

    // Get context and render
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    ctx.putImageData(imageData, 0, 0);
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

  /**
   * Convert buffer to Blob
   * @param buffer - GPU buffer containing RGBA data
   * @param dimensions - Image dimensions
   * @param format - Image format (default: 'image/png')
   * @param quality - Image quality for JPEG (0-1, default: 0.92)
   * @returns Blob
   */
  public async bufferToBlob(
    buffer: GPUBuffer,
    dimensions: Dimensions,
    format: string = 'image/png',
    quality: number = 0.92
  ): Promise<Blob> {
    const imageData = await this.bufferToImageData(buffer, dimensions);

    // Use OffscreenCanvas if available
    if (this.useOffscreenCanvas) {
      const offscreen = new OffscreenCanvas(dimensions.width, dimensions.height);
      const ctx = offscreen.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get OffscreenCanvas 2D context');
      }

      ctx.putImageData(imageData, 0, 0);
      return await offscreen.convertToBlob({ type: format, quality });
    }

    // Fallback to regular canvas
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        format,
        quality
      );
    });
  }

  /**
   * Create a thumbnail from GPU buffer
   * @param buffer - GPU buffer containing RGBA data
   * @param sourceDimensions - Source image dimensions
   * @param thumbnailSize - Maximum thumbnail dimension
   * @returns ImageData for thumbnail
   */
  public async createThumbnail(
    buffer: GPUBuffer,
    sourceDimensions: Dimensions,
    thumbnailSize: number = 256
  ): Promise<ImageData> {
    const imageData = await this.bufferToImageData(buffer, sourceDimensions);

    // Calculate thumbnail dimensions maintaining aspect ratio
    const aspectRatio = sourceDimensions.width / sourceDimensions.height;
    let thumbWidth: number;
    let thumbHeight: number;

    if (aspectRatio > 1) {
      thumbWidth = thumbnailSize;
      thumbHeight = Math.round(thumbnailSize / aspectRatio);
    } else {
      thumbWidth = Math.round(thumbnailSize * aspectRatio);
      thumbHeight = thumbnailSize;
    }

    // Create source canvas
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceDimensions.width;
    sourceCanvas.height = sourceDimensions.height;

    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) {
      throw new Error('Failed to get source 2D context');
    }

    sourceCtx.putImageData(imageData, 0, 0);

    // Create thumbnail canvas
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbWidth;
    thumbCanvas.height = thumbHeight;

    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) {
      throw new Error('Failed to get thumbnail 2D context');
    }

    // Draw scaled
    thumbCtx.drawImage(sourceCanvas, 0, 0, thumbWidth, thumbHeight);

    return thumbCtx.getImageData(0, 0, thumbWidth, thumbHeight);
  }

  /**
   * Get pixel color from buffer
   * @param buffer - GPU buffer containing RGBA data
   * @param x - Pixel x coordinate
   * @param y - Pixel y coordinate
   * @param width - Image width
   * @returns RGBA color array
   */
  public async getPixelColor(
    buffer: GPUBuffer,
    x: number,
    y: number,
    width: number
  ): Promise<[number, number, number, number]> {
    const data = await this.bufferManager.readFromBuffer(buffer);
    const uint8Data = new Uint8ClampedArray(data);

    const index = (y * width + x) * 4;

    return [uint8Data[index], uint8Data[index + 1], uint8Data[index + 2], uint8Data[index + 3]];
  }

  /**
   * Check if OffscreenCanvas is supported
   */
  public isOffscreenCanvasSupported(): boolean {
    return this.useOffscreenCanvas;
  }
}
