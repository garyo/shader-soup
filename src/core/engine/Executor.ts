/**
 * Executor - Execute compute shaders and manage command queues
 */

import { WebGPUContext } from './WebGPUContext';
import { GPUExecutionError } from '@/types/errors';
import type { ExecutionContext, WorkgroupDimensions, PerformanceMetrics } from '@/types/core';

export class Executor {
  private context: WebGPUContext;
  private enableProfiling: boolean;

  constructor(context: WebGPUContext, enableProfiling: boolean = false) {
    this.context = context;
    this.enableProfiling = enableProfiling;
  }

  /**
   * Execute a single compute shader
   * @param executionContext - Execution context with pipeline and bind group
   * @returns Performance metrics if profiling enabled
   */
  public async execute(executionContext: ExecutionContext): Promise<PerformanceMetrics | undefined> {
    const startTime = this.enableProfiling ? performance.now() : 0;

    const device = this.context.getDevice();

    try {
      // Create command encoder
      const encoder = device.createCommandEncoder({
        label: 'compute-encoder',
      });

      // Begin compute pass
      const pass = encoder.beginComputePass({
        label: 'compute-pass',
      });

      // Set pipeline and bind group
      pass.setPipeline(executionContext.pipeline);
      pass.setBindGroup(0, executionContext.bindGroup);

      // Dispatch workgroups
      pass.dispatchWorkgroups(
        executionContext.workgroups.x,
        executionContext.workgroups.y,
        executionContext.workgroups.z ?? 1
      );

      // End compute pass
      pass.end();

      // Submit commands
      const commandBuffer = encoder.finish();
      device.queue.submit([commandBuffer]);

      // Wait for completion
      await device.queue.onSubmittedWorkDone();

      if (this.enableProfiling) {
        const endTime = performance.now();
        return {
          compilationTime: 0, // Not measured here
          executionTime: endTime - startTime,
          bufferUploadTime: 0,
          bufferDownloadTime: 0,
          totalTime: endTime - startTime,
        };
      }
    } catch (error) {
      throw new GPUExecutionError(
        `Shader execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return undefined;
  }

  /**
   * Execute multiple compute shaders in parallel
   * @param contexts - Array of execution contexts
   * @returns Array of performance metrics (if profiling enabled)
   */
  public async executeMultiple(
    contexts: ExecutionContext[]
  ): Promise<(PerformanceMetrics | undefined)[]> {
    const startTime = this.enableProfiling ? performance.now() : 0;

    const device = this.context.getDevice();

    try {
      // Create command buffers for all contexts
      const commandBuffers: GPUCommandBuffer[] = [];

      for (const context of contexts) {
        const encoder = device.createCommandEncoder({
          label: `compute-encoder-${contexts.indexOf(context)}`,
        });

        const pass = encoder.beginComputePass();

        pass.setPipeline(context.pipeline);
        pass.setBindGroup(0, context.bindGroup);

        pass.dispatchWorkgroups(
          context.workgroups.x,
          context.workgroups.y,
          context.workgroups.z ?? 1
        );

        pass.end();

        commandBuffers.push(encoder.finish());
      }

      // Submit all command buffers at once
      device.queue.submit(commandBuffers);

      // Wait for completion
      await device.queue.onSubmittedWorkDone();

      if (this.enableProfiling) {
        const endTime = performance.now();
        const totalTime = endTime - startTime;

        // Return metrics for each context
        return contexts.map(() => ({
          compilationTime: 0,
          executionTime: totalTime / contexts.length,
          bufferUploadTime: 0,
          bufferDownloadTime: 0,
          totalTime,
        }));
      }

      return contexts.map(() => undefined);
    } catch (error) {
      throw new GPUExecutionError(
        `Multi-shader execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute a compute pass with custom command encoding
   * @param callback - Callback to encode commands
   */
  public async executeCustom(
    callback: (encoder: GPUCommandEncoder, device: GPUDevice) => void
  ): Promise<void> {
    const device = this.context.getDevice();

    try {
      const encoder = device.createCommandEncoder();
      callback(encoder, device);
      const commandBuffer = encoder.finish();
      device.queue.submit([commandBuffer]);
      await device.queue.onSubmittedWorkDone();
    } catch (error) {
      throw new GPUExecutionError(
        `Custom execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Calculate optimal workgroup dimensions for given output size
   * @param width - Output width
   * @param height - Output height
   * @param workgroupSize - Workgroup size (default: 8x8)
   * @returns Workgroup dimensions
   */
  public calculateWorkgroups(
    width: number,
    height: number,
    workgroupSize: { x: number; y: number } = { x: 8, y: 8 }
  ): WorkgroupDimensions {
    return {
      x: Math.ceil(width / workgroupSize.x),
      y: Math.ceil(height / workgroupSize.y),
      z: 1,
    };
  }

  /**
   * Enable or disable profiling
   */
  public setProfiling(enabled: boolean): void {
    this.enableProfiling = enabled;
  }

  /**
   * Check if profiling is enabled
   */
  public isProfilingEnabled(): boolean {
    return this.enableProfiling;
  }
}

/**
 * Helper function to create execution context
 */
export function createExecutionContext(
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: WorkgroupDimensions,
  outputBuffer: GPUBuffer
): ExecutionContext {
  return {
    pipeline,
    bindGroup,
    workgroups,
    outputBuffer,
  };
}
