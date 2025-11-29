/**
 * WebGPU Context - Singleton for managing WebGPU device and adapter
 */

import { WebGPUNotSupportedError } from '@/types/errors';

export class WebGPUContext {
  private static instance: WebGPUContext | null = null;
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private canvasFormat: GPUTextureFormat = 'rgba8unorm';
  private storageFormat: GPUTextureFormat = 'rgba32float'; // HDR-capable format (16 bytes/pixel, matches vec4<f32>)
  private supportsBgraStorage: boolean = false;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): WebGPUContext {
    if (!WebGPUContext.instance) {
      WebGPUContext.instance = new WebGPUContext();
    }
    return WebGPUContext.instance;
  }

  /**
   * Check if WebGPU is supported
   */
  public static isSupported(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return 'gpu' in navigator;
  }

  /**
   * Initialize WebGPU adapter and device
   */
  public async initialize(): Promise<void> {
    // Return existing initialization promise if already initializing
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Return immediately if already initialized
    if (this.initialized) {
      return;
    }

    // Create and store initialization promise
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Perform the actual initialization
   */
  private async performInitialization(): Promise<void> {
    if (!WebGPUContext.isSupported()) {
      throw new WebGPUNotSupportedError('WebGPU is not supported in this browser');
    }

    // Request adapter
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!this.adapter) {
      throw new WebGPUNotSupportedError('Failed to request WebGPU adapter');
    }

    // Check for optional features
    const features: GPUFeatureName[] = [];

    if (this.adapter.features.has('shader-f16')) {
      features.push('shader-f16');
      console.log('[WebGPU] shader-f16 feature available and enabled');
    } else {
      console.warn('[WebGPU] shader-f16 feature not available');
    }

    // rgba32float is ALWAYS supported for storage textures (core WebGPU spec)
    // rgba16float requires texture-formats-tier2 for canvas display (HDR)
    this.storageFormat = 'rgba32float'; // Always use rgba32float for compute shader output

    if (this.adapter.features.has('texture-formats-tier2')) {
      features.push('texture-formats-tier2');
      this.canvasFormat = 'rgba16float'; // HDR display
      console.log('[WebGPU] texture-formats-tier2 available - HDR enabled (rgba16float canvas)');
    } else {
      this.canvasFormat = 'rgba8unorm'; // SDR fallback
      console.log('[WebGPU] Using rgba8unorm canvas (SDR), rgba32float storage (always supported)');
    }

    // Request device with higher buffer size limits for high-res rendering
    try {
      // Request higher limits if adapter supports them
      const adapterLimits = this.adapter.limits;
      const requiredLimits: Record<string, number> = {};

      // Request higher buffer size limit (up to 1GB or adapter max)
      if (adapterLimits.maxBufferSize > 256 * 1024 * 1024) {
        requiredLimits.maxBufferSize = Math.min(1024 * 1024 * 1024, adapterLimits.maxBufferSize);
        console.log(`[WebGPU] Requesting maxBufferSize: ${(requiredLimits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
      }

      // Request higher storage buffer binding size (up to 1GB or adapter max)
      if (adapterLimits.maxStorageBufferBindingSize > 128 * 1024 * 1024) {
        requiredLimits.maxStorageBufferBindingSize = Math.min(1024 * 1024 * 1024, adapterLimits.maxStorageBufferBindingSize);
        console.log(`[WebGPU] Requesting maxStorageBufferBindingSize: ${(requiredLimits.maxStorageBufferBindingSize / 1024 / 1024).toFixed(2)} MB`);
      }

      this.device = await this.adapter.requestDevice({
        requiredFeatures: features,
        requiredLimits,
      });

      // Handle device lost
      this.device.lost.then((info) => {
        console.error('WebGPU device lost:', info.message);
        this.initialized = false;
        this.device = null;

        if (info.reason !== 'destroyed') {
          console.warn('Device lost unexpectedly. May need to reinitialize.');
        }
      });

      // Handle uncaptured errors
      this.device.addEventListener('uncapturederror', (event) => {
        console.error('WebGPU uncaptured error:', event.error);
      });

      this.initialized = true;
    } catch (error) {
      throw new WebGPUNotSupportedError(
        `Failed to request WebGPU device: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the WebGPU adapter
   * @throws {WebGPUNotSupportedError} if not initialized
   */
  public getAdapter(): GPUAdapter {
    if (!this.adapter) {
      throw new WebGPUNotSupportedError('WebGPU context not initialized. Call initialize() first.');
    }
    return this.adapter;
  }

  /**
   * Get the WebGPU device
   * @throws {WebGPUNotSupportedError} if not initialized
   */
  public getDevice(): GPUDevice {
    if (!this.device) {
      throw new WebGPUNotSupportedError('WebGPU context not initialized. Call initialize() first.');
    }
    return this.device;
  }

  /**
   * Check if the context is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get adapter information
   */
  public getAdapterInfo(): {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  } | null {
    if (!this.adapter) {
      return null;
    }

    const info = this.adapter.info;
    return {
      vendor: info.vendor || 'Unknown',
      architecture: info.architecture || 'Unknown',
      device: info.device || 'Unknown',
      description: info.description || 'Unknown',
    };
  }

  /**
   * Get device limits
   */
  public getDeviceLimits(): GPUSupportedLimits | null {
    if (!this.device) {
      return null;
    }
    return this.device.limits;
  }

  /**
   * Destroy the device and cleanup resources
   */
  public async destroy(): Promise<void> {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }

    this.adapter = null;
    this.initialized = false;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static reset(): void {
    if (WebGPUContext.instance) {
      WebGPUContext.instance.destroy();
      WebGPUContext.instance = null;
    }
  }

  /**
   * Get the canvas format to use for display
   */
  public getCanvasFormat(): GPUTextureFormat {
    return this.canvasFormat;
  }

  /**
   * Get the storage texture format for compute shader output (HDR-capable)
   */
  public getStorageFormat(): GPUTextureFormat {
    return this.storageFormat;
  }

  /**
   * Check if bgra8unorm storage is supported
   */
  public supportsBgraStorageTextures(): boolean {
    return this.supportsBgraStorage;
  }

  /**
   * Configure a canvas for direct WebGPU HDR rendering with storage texture support
   * @param canvas - Canvas element to configure
   * @returns Configured GPU canvas context
   */
  public configureCanvas(canvas: HTMLCanvasElement): GPUCanvasContext {
    if (!this.device) {
      throw new WebGPUNotSupportedError('WebGPU context not initialized. Call initialize() first.');
    }

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context from canvas');
    }

    // Configure with rgba16float and extended tone mapping for HDR
    // STORAGE_BINDING allows compute shaders to write directly
    context.configure({
      device: this.device,
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
      alphaMode: 'opaque',
      toneMapping: { mode: 'extended' }, // Enable HDR display on compatible screens
    });

    console.log('[WebGPU] Canvas configured for HDR:', this.canvasFormat, 'with extended tone mapping');

    return context;
  }
}

/**
 * Convenience function to get initialized WebGPU context
 */
export async function getWebGPUContext(): Promise<WebGPUContext> {
  const context = WebGPUContext.getInstance();
  await context.initialize();
  return context;
}
