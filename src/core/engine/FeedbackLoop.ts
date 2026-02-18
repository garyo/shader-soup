/**
 * Feedback Loop Utility
 * Provides utilities for handling iterative shader execution with texture ping-pong
 */

/**
 * Parameters for feedback loop iteration callback
 */
export interface FeedbackIterationContext {
  /** The previous frame texture to read from */
  prevTexture: GPUTexture;
  /** The sampler for the previous frame texture */
  prevSampler: GPUSampler;
  /** Whether this is the last iteration */
  isLastIteration: boolean;
  /** Current iteration number (0-based) */
  iterationNumber: number;
}

/**
 * Executes shader with feedback loop using texture ping-pong pattern
 *
 * This helper manages the complexity of iterative shader execution:
 * - Creates two textures for ping-pong buffer
 * - Initializes the first texture with zeros
 * - Alternates between textures for each iteration
 * - Copies output texture to feedback texture for next iteration
 * - Handles cleanup
 *
 * @param device - The GPU device
 * @param dimensions - Texture dimensions {width, height}
 * @param iterations - Number of iterations to execute
 * @param outputTexture - The output texture to copy from after each iteration
 * @param labelSuffix - Optional suffix for texture labels (e.g., 'hires')
 * @param onIteration - Callback executed for each iteration, receives context with prevTexture/prevSampler
 * @param initialTexture - Optional texture to seed the first iteration (for inter-frame feedback). If not provided, starts from black.
 *
 * @example
 * await executeFeedbackLoop(device, {width: 512, height: 512}, 10, outputTexture, '', async (ctx) => {
 *   const bindGroup = createBindGroup(..., ctx.prevTexture, ctx.prevSampler);
 *   await executor.execute(createExecutionContext(pipeline, bindGroup, workgroups, outputTexture));
 * });
 */
export async function executeFeedbackLoop(
  device: GPUDevice,
  dimensions: { width: number; height: number },
  iterations: number,
  outputTexture: GPUTexture,
  labelSuffix: string,
  onIteration: (context: FeedbackIterationContext) => Promise<void>,
  initialTexture?: GPUTexture,
): Promise<void> {
  // Create two textures for ping-pong
  const label = labelSuffix ? `-${labelSuffix}` : '';
  const textureA = device.createTexture({
    size: [dimensions.width, dimensions.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: `feedback-texture-A${label}`,
  });
  const textureB = device.createTexture({
    size: [dimensions.width, dimensions.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: `feedback-texture-B${label}`,
  });

  try {
    // Initialize textureB for first iteration
    if (initialTexture) {
      // Seed from provided texture (inter-frame feedback)
      const commandEncoder = device.createCommandEncoder({ label: 'feedback-init-copy' });
      commandEncoder.copyTextureToTexture(
        { texture: initialTexture },
        { texture: textureB },
        [dimensions.width, dimensions.height]
      );
      device.queue.submit([commandEncoder.finish()]);
    } else {
      // Start from black/zero
      // rgba32float uses 16 bytes per pixel (4 channels * 4 bytes each)
      const zeroData = new Float32Array(dimensions.width * dimensions.height * 4);
      device.queue.writeTexture(
        { texture: textureB },
        zeroData,
        { bytesPerRow: dimensions.width * 16 },
        [dimensions.width, dimensions.height]
      );
    }

    // Create sampler for prevFrame (non-filtering for rgba32float)
    const prevSampler = device.createSampler({
      addressModeU: 'mirror-repeat',
      addressModeV: 'mirror-repeat',
      magFilter: 'nearest',
      minFilter: 'nearest',
    });

    // Ping-pong between textures
    for (let iter = 0; iter < iterations; iter++) {
      const isLastIter = iter === iterations - 1;
      const currentTexture = iter % 2 === 0 ? textureA : textureB;
      const prevTexture = iter % 2 === 0 ? textureB : textureA;

      // Execute iteration callback with context
      await onIteration({
        prevTexture,
        prevSampler,
        isLastIteration: isLastIter,
        iterationNumber: iter,
      });

      // Copy output texture to current texture for next iteration (unless last)
      if (!isLastIter) {
        const commandEncoder = device.createCommandEncoder();
        commandEncoder.copyTextureToTexture(
          { texture: outputTexture },
          { texture: currentTexture },
          [dimensions.width, dimensions.height]
        );
        device.queue.submit([commandEncoder.finish()]);
      }
    }
  } finally {
    // Always cleanup textures, even if iteration callback throws
    textureA.destroy();
    textureB.destroy();
  }
}
