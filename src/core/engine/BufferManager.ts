/**
 * Buffer Manager - Manages GPU buffer allocation and reuse
 */

import { WebGPUContext } from './WebGPUContext';
import { BufferAllocationError } from '@/types/errors';
import type { BufferDescriptor, PooledBuffer } from '@/types/core';

export class BufferManager {
  private context: WebGPUContext;
  private bufferPool: Map<string, PooledBuffer[]> = new Map();
  private maxPoolSize: number = 50;
  private maxBufferAge: number = 60000; // 60 seconds

  constructor(context: WebGPUContext, maxPoolSize: number = 50) {
    this.context = context;
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Create a GPU buffer
   * @param descriptor - Buffer descriptor
   * @param tryPool - Whether to try getting from pool (default: true)
   * @returns GPU buffer
   */
  public createBuffer(descriptor: BufferDescriptor, tryPool: boolean = true): GPUBuffer {
    const device = this.context.getDevice();

    // Try to get from pool if enabled
    if (tryPool) {
      const pooled = this.getFromPool(descriptor.size, descriptor.usage);
      if (pooled) {
        return pooled;
      }
    }

    // Create new buffer
    try {
      const buffer = device.createBuffer({
        size: descriptor.size,
        usage: descriptor.usage,
        label: descriptor.label,
        mappedAtCreation: false,
      });

      return buffer;
    } catch (error) {
      throw new BufferAllocationError(
        `Failed to create buffer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        descriptor.size
      );
    }
  }

  /**
   * Write data to a buffer
   * @param buffer - GPU buffer
   * @param data - Data to write
   * @param offset - Offset in bytes (default: 0)
   */
  public writeToBuffer(
    buffer: GPUBuffer,
    data: BufferSource | SharedArrayBuffer,
    offset: number = 0
  ): void {
    const device = this.context.getDevice();
    device.queue.writeBuffer(buffer, offset, data);
  }

  /**
   * Read data from a buffer (async)
   * Uses staging buffer pattern for storage buffers
   * @param buffer - GPU buffer
   * @param offset - Offset in bytes (default: 0)
   * @param size - Size to read (default: buffer size)
   * @returns ArrayBuffer with data
   */
  public async readFromBuffer(
    buffer: GPUBuffer,
    offset: number = 0,
    size?: number
  ): Promise<ArrayBuffer> {
    const readSize = size ?? buffer.size;
    const device = this.context.getDevice();

    // Create staging buffer with MAP_READ usage
    const stagingBuffer = device.createBuffer({
      size: readSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'staging-buffer',
    });

    // Copy from source buffer to staging buffer
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, offset, stagingBuffer, 0, readSize);
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Wait for GPU to finish copy operation
    await device.queue.onSubmittedWorkDone();

    // Map staging buffer for reading
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const mappedRange = stagingBuffer.getMappedRange();

    // Copy data (mapped range is invalidated when unmapped)
    const data = mappedRange.slice(0);

    // Unmap and destroy staging buffer
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Copy buffer to buffer
   * @param source - Source buffer
   * @param destination - Destination buffer
   * @param size - Size to copy (default: source size)
   * @param sourceOffset - Source offset (default: 0)
   * @param destinationOffset - Destination offset (default: 0)
   */
  public copyBuffer(
    source: GPUBuffer,
    destination: GPUBuffer,
    size?: number,
    sourceOffset: number = 0,
    destinationOffset: number = 0
  ): void {
    const device = this.context.getDevice();
    const encoder = device.createCommandEncoder();

    encoder.copyBufferToBuffer(
      source,
      sourceOffset,
      destination,
      destinationOffset,
      size ?? source.size
    );

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }

  /**
   * Return buffer to pool for reuse
   * @param buffer - Buffer to return
   * @param size - Buffer size
   * @param usage - Buffer usage flags
   */
  public returnToPool(buffer: GPUBuffer, size: number, usage: GPUBufferUsageFlags): void {
    const key = this.getPoolKey(size, usage);
    let pool = this.bufferPool.get(key);

    if (!pool) {
      pool = [];
      this.bufferPool.set(key, pool);
    }

    // Don't add if pool is full
    if (pool.length >= this.maxPoolSize) {
      buffer.destroy();
      return;
    }

    pool.push({
      buffer,
      size,
      usage,
      inUse: false,
      lastUsed: Date.now(),
    });
  }

  /**
   * Get buffer from pool
   * @param size - Required buffer size
   * @param usage - Required usage flags
   * @returns Buffer from pool or null
   */
  private getFromPool(size: number, usage: GPUBufferUsageFlags): GPUBuffer | null {
    const key = this.getPoolKey(size, usage);
    const pool = this.bufferPool.get(key);

    if (!pool || pool.length === 0) {
      return null;
    }

    // Find available buffer
    const pooled = pool.find((p) => !p.inUse);

    if (!pooled) {
      return null;
    }

    pooled.inUse = true;
    pooled.lastUsed = Date.now();

    return pooled.buffer;
  }

  /**
   * Generate pool key from size and usage
   */
  private getPoolKey(size: number, usage: GPUBufferUsageFlags): string {
    return `${size}-${usage}`;
  }

  /**
   * Clean up old buffers from pool
   */
  public cleanupPool(): void {
    const now = Date.now();

    for (const [key, pool] of this.bufferPool.entries()) {
      // Remove buffers that are old and not in use
      const remaining = pool.filter((pooled) => {
        if (!pooled.inUse && now - pooled.lastUsed > this.maxBufferAge) {
          pooled.buffer.destroy();
          return false;
        }
        return true;
      });

      if (remaining.length === 0) {
        this.bufferPool.delete(key);
      } else {
        this.bufferPool.set(key, remaining);
      }
    }
  }

  /**
   * Destroy all buffers in pool
   */
  public destroyPool(): void {
    for (const pool of this.bufferPool.values()) {
      for (const pooled of pool) {
        pooled.buffer.destroy();
      }
    }
    this.bufferPool.clear();
  }

  /**
   * Get pool statistics
   */
  public getPoolStats(): {
    totalBuffers: number;
    buffersInUse: number;
    poolKeys: number;
  } {
    let totalBuffers = 0;
    let buffersInUse = 0;

    for (const pool of this.bufferPool.values()) {
      totalBuffers += pool.length;
      buffersInUse += pool.filter((p) => p.inUse).length;
    }

    return {
      totalBuffers,
      buffersInUse,
      poolKeys: this.bufferPool.size,
    };
  }

  /**
   * Create a buffer filled with data
   * @param data - Data to fill buffer with
   * @param usage - Buffer usage flags
   * @param label - Optional label
   * @returns GPU buffer filled with data
   */
  public createBufferWithData(
    data: BufferSource | SharedArrayBuffer,
    usage: GPUBufferUsageFlags,
    label?: string
  ): GPUBuffer {
    const size = data instanceof ArrayBuffer
      ? data.byteLength
      : (data as ArrayBufferView).byteLength;

    const buffer = this.createBuffer({ size, usage, label }, false);
    this.writeToBuffer(buffer, data);

    return buffer;
  }
}
