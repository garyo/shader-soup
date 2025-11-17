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

    // Check if shader-f16 is supported
    const features: GPUFeatureName[] = [];
    if (this.adapter.features.has('shader-f16')) {
      features.push('shader-f16');
      console.log('[WebGPU] shader-f16 feature available and enabled');
    } else {
      console.warn('[WebGPU] shader-f16 feature not available');
    }

    // Request device
    try {
      this.device = await this.adapter.requestDevice({
        requiredFeatures: features,
        requiredLimits: {},
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
}

/**
 * Convenience function to get initialized WebGPU context
 */
export async function getWebGPUContext(): Promise<WebGPUContext> {
  const context = WebGPUContext.getInstance();
  await context.initialize();
  return context;
}
