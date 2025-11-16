/**
 * Image Processor - Load and process images for GPU use
 */

import { WebGPUContext } from '../engine/WebGPUContext';
import type { Dimensions } from '@/types/core';

export class ImageProcessor {
  private context: WebGPUContext;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Load image from File
   * @param file - Image file
   * @returns ImageData
   */
  public async loadImage(file: File): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = () => {
          const imageData = this.imageToImageData(img);
          resolve(imageData);
        };

        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };

        img.src = e.target?.result as string;
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Load image from URL
   * @param url - Image URL
   * @returns ImageData
   */
  public async loadImageFromURL(url: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const imageData = this.imageToImageData(img);
        resolve(imageData);
      };

      img.onerror = () => {
        reject(new Error(`Failed to load image from URL: ${url}`));
      };

      img.crossOrigin = 'anonymous';
      img.src = url;
    });
  }

  /**
   * Convert HTMLImageElement to ImageData
   * @param image - HTML image element
   * @returns ImageData
   */
  public imageToImageData(image: HTMLImageElement): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  }

  /**
   * Convert ImageData to GPU texture
   * @param imageData - Image data
   * @param label - Optional label for debugging
   * @returns GPU texture
   */
  public toGPUTexture(imageData: ImageData, label?: string): GPUTexture {
    const device = this.context.getDevice();

    const texture = device.createTexture({
      label,
      size: {
        width: imageData.width,
        height: imageData.height,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Write image data to texture
    device.queue.writeTexture(
      { texture },
      imageData.data,
      {
        offset: 0,
        bytesPerRow: imageData.width * 4,
        rowsPerImage: imageData.height,
      },
      {
        width: imageData.width,
        height: imageData.height,
        depthOrArrayLayers: 1,
      }
    );

    return texture;
  }

  /**
   * Resize ImageData
   * @param imageData - Source image data
   * @param dimensions - Target dimensions
   * @returns Resized ImageData
   */
  public resizeImage(imageData: ImageData, dimensions: Dimensions): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    // Draw original image
    ctx.putImageData(imageData, 0, 0);

    // Create resized canvas
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = dimensions.width;
    resizedCanvas.height = dimensions.height;

    const resizedCtx = resizedCanvas.getContext('2d');
    if (!resizedCtx) {
      throw new Error('Failed to get 2D context for resize');
    }

    // Draw scaled image
    resizedCtx.drawImage(canvas, 0, 0, dimensions.width, dimensions.height);

    return resizedCtx.getImageData(0, 0, dimensions.width, dimensions.height);
  }

  /**
   * Get image dimensions
   * @param imageData - Image data
   * @returns Dimensions
   */
  public getDimensions(imageData: ImageData): Dimensions {
    return {
      width: imageData.width,
      height: imageData.height,
    };
  }

  /**
   * Validate image file type
   * @param file - File to validate
   * @returns True if valid image type
   */
  public static isValidImageType(file: File): boolean {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    return validTypes.includes(file.type);
  }

  /**
   * Validate image file size
   * @param file - File to validate
   * @param maxSizeBytes - Maximum size in bytes (default: 10MB)
   * @returns True if within size limit
   */
  public static isValidImageSize(file: File, maxSizeBytes: number = 10 * 1024 * 1024): boolean {
    return file.size <= maxSizeBytes;
  }

  /**
   * Create a sampler for texture sampling
   * @param filterMode - Filter mode (default: 'linear')
   * @returns GPU sampler
   */
  public createSampler(filterMode: GPUFilterMode = 'linear'): GPUSampler {
    const device = this.context.getDevice();

    return device.createSampler({
      magFilter: filterMode,
      minFilter: filterMode,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create a blank ImageData
   * @param dimensions - Image dimensions
   * @param color - Fill color [r, g, b, a] (default: transparent)
   * @returns ImageData
   */
  public static createBlankImage(
    dimensions: Dimensions,
    color: [number, number, number, number] = [0, 0, 0, 0]
  ): ImageData {
    const imageData = new ImageData(dimensions.width, dimensions.height);

    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = color[0];
      imageData.data[i + 1] = color[1];
      imageData.data[i + 2] = color[2];
      imageData.data[i + 3] = color[3];
    }

    return imageData;
  }
}
