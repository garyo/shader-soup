/**
 * Animation Controller - Manages per-shader animation loops
 * Caches prepared shader resources and only updates time/frame each frame.
 */

import type { WebGPUContext } from './WebGPUContext';
import type { PipelineBuilder } from './PipelineBuilder';
import type { Executor } from './Executor';
import type { GPUPostProcessor } from './GPUPostProcessor';
import type { ShaderPreparationResult } from './ShaderPreparation';
import { createExecutionContext } from './Executor';
import { executeFeedbackLoop } from './FeedbackLoop';
import { withGPUErrorScope } from './GPUErrorHandler';

export interface AnimationState {
  /** Cached preparation result */
  prep: ShaderPreparationResult;
  /** Shader ID */
  shaderId: string;
  /** Animation frame request ID */
  rafId: number;
  /** Start time (performance.now()) */
  startTime: number;
  /** Frame counter */
  frameCount: number;
  /** Render dimensions (supersampled) */
  superDimensions: { width: number; height: number };
  /** Display dimensions */
  displayDimensions: { width: number; height: number };
  /** Global params for post-processing */
  globalParams: { gamma: number; contrast: number };
}

export type OnFrameRendered = (shaderId: string, gpuTexture: GPUTexture) => void;

export class AnimationController {
  private animations: Map<string, AnimationState> = new Map();
  private feedbackTextures: Map<string, GPUTexture> = new Map();
  private feedbackSamplers: Map<string, GPUSampler> = new Map();
  private context: WebGPUContext;
  private pipelineBuilder: PipelineBuilder;
  private executor: Executor;
  private gpuPostProcessor: GPUPostProcessor;
  private onFrameRendered: OnFrameRendered;

  constructor(
    context: WebGPUContext,
    pipelineBuilder: PipelineBuilder,
    executor: Executor,
    gpuPostProcessor: GPUPostProcessor,
    onFrameRendered: OnFrameRendered,
  ) {
    this.context = context;
    this.pipelineBuilder = pipelineBuilder;
    this.executor = executor;
    this.gpuPostProcessor = gpuPostProcessor;
    this.onFrameRendered = onFrameRendered;
  }

  /**
   * Start animating a shader with cached preparation result
   */
  startAnimation(
    shaderId: string,
    prep: ShaderPreparationResult,
    superDimensions: { width: number; height: number },
    displayDimensions: { width: number; height: number },
    globalParams: { gamma: number; contrast: number },
  ): void {
    // Stop any existing animation for this shader (also cleans up feedback textures)
    this.stopAnimation(shaderId);

    // Create persistent feedback texture if shader uses prevFrame
    if (prep.hasInputTexture) {
      const device = this.context.getDevice();
      const feedbackTexture = device.createTexture({
        size: [superDimensions.width, superDimensions.height],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        label: `feedback-persistent-${shaderId}`,
      });
      // Initialize to black
      const zeroData = new Float32Array(superDimensions.width * superDimensions.height * 4);
      device.queue.writeTexture(
        { texture: feedbackTexture },
        zeroData,
        { bytesPerRow: superDimensions.width * 16 },
        [superDimensions.width, superDimensions.height]
      );
      this.feedbackTextures.set(shaderId, feedbackTexture);

      const feedbackSampler = device.createSampler({
        addressModeU: 'mirror-repeat',
        addressModeV: 'mirror-repeat',
        magFilter: 'nearest',
        minFilter: 'nearest',
      });
      this.feedbackSamplers.set(shaderId, feedbackSampler);
    }

    const state: AnimationState = {
      prep,
      shaderId,
      rafId: 0,
      startTime: performance.now(),
      frameCount: 0,
      superDimensions,
      displayDimensions,
      globalParams,
    };

    this.animations.set(shaderId, state);

    // Start the animation loop
    const animate = () => {
      const currentState = this.animations.get(shaderId);
      if (!currentState) return; // Animation was stopped

      this.renderFrame(currentState).then(() => {
        // Check again — animation might have been stopped during render
        if (this.animations.has(shaderId)) {
          currentState.rafId = requestAnimationFrame(animate);
        }
      }).catch(err => {
        console.error(`Animation frame error for ${shaderId}:`, err);
        this.stopAnimation(shaderId);
      });
    };

    state.rafId = requestAnimationFrame(animate);
  }

  /**
   * Stop animating a shader
   */
  stopAnimation(shaderId: string): void {
    const state = this.animations.get(shaderId);
    if (state) {
      cancelAnimationFrame(state.rafId);
      this.animations.delete(shaderId);
    }
    // Clean up persistent feedback textures
    const feedbackTexture = this.feedbackTextures.get(shaderId);
    if (feedbackTexture) {
      feedbackTexture.destroy();
      this.feedbackTextures.delete(shaderId);
      this.feedbackSamplers.delete(shaderId);
    }
  }

  /**
   * Check if a shader is currently animating
   */
  isAnimating(shaderId: string): boolean {
    return this.animations.has(shaderId);
  }

  /**
   * Update the parameter buffer for a running animation in-place.
   * This avoids recreating resources and prevents race conditions with the animation loop.
   */
  updateParameterBuffer(shaderId: string, paramData: ArrayBuffer): void {
    const state = this.animations.get(shaderId);
    if (!state || !state.prep.paramBuffer) return;
    const device = this.context.getDevice();
    device.queue.writeBuffer(state.prep.paramBuffer, 0, paramData);
  }

  /**
   * Update global parameters (zoom, pan, gamma, contrast) for a running animation.
   * Zoom/pan are written to the dimensions buffer; gamma/contrast update post-processing state.
   */
  updateGlobalParams(shaderId: string, globalParams: { zoom: number; panX: number; panY: number; gamma: number; contrast: number }): void {
    const state = this.animations.get(shaderId);
    if (!state) return;
    const device = this.context.getDevice();
    // Update zoom at offset 8 (field index 2)
    device.queue.writeBuffer(state.prep.dimensionsBuffer, 8, new Float32Array([globalParams.zoom]));
    // Update panX at offset 16, panY at offset 20
    device.queue.writeBuffer(state.prep.dimensionsBuffer, 16, new Float32Array([globalParams.panX, globalParams.panY]));
    // Update post-processing params
    state.globalParams = { gamma: globalParams.gamma, contrast: globalParams.contrast };
  }

  /**
   * Stop all animations
   */
  stopAll(): void {
    for (const [shaderId] of this.animations) {
      this.stopAnimation(shaderId);
    }
  }

  /**
   * Render a single animation frame
   */
  private async renderFrame(state: AnimationState): Promise<void> {
    const { prep, shaderId, superDimensions } = state;
    const device = this.context.getDevice();

    // Update time and frame in the dimensions buffer
    const elapsed = (performance.now() - state.startTime) / 1000.0; // seconds
    state.frameCount++;

    // Write time (f32) at offset 24 (field index 6)
    const timeData = new Float32Array([elapsed]);
    device.queue.writeBuffer(prep.dimensionsBuffer, 24, timeData);

    // Write frame (u32) at offset 28 (field index 7)
    const frameData = new Uint32Array([state.frameCount]);
    device.queue.writeBuffer(prep.dimensionsBuffer, 28, frameData);

    // Execute shader
    const feedbackTexture = this.feedbackTextures.get(shaderId);
    const feedbackSampler = this.feedbackSamplers.get(shaderId);

    await withGPUErrorScope(device, 'animation frame', async () => {
      if (prep.hasInputTexture && prep.hasIterations && feedbackTexture && feedbackSampler) {
        // Case A: prevFrame + iterations — run feedback loop seeded from persistent texture
        await executeFeedbackLoop(
          device,
          superDimensions,
          prep.iterations,
          prep.outputTexture,
          '',
          async (ctx) => {
            const bindGroup = this.pipelineBuilder.createStandardBindGroup(
              prep.layout,
              prep.outputTexture,
              prep.dimensionsBuffer,
              prep.paramBuffer,
              ctx.prevTexture,
              ctx.prevSampler,
            );
            const executionContext = createExecutionContext(
              prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
            );
            await this.executor.execute(executionContext);
          },
          feedbackTexture, // seed from previous frame's output
        );
        // Copy final output back to persistent feedback texture for next frame
        const copyEncoder = device.createCommandEncoder({ label: 'feedback-persist-copy' });
        copyEncoder.copyTextureToTexture(
          { texture: prep.outputTexture },
          { texture: feedbackTexture },
          [superDimensions.width, superDimensions.height]
        );
        device.queue.submit([copyEncoder.finish()]);
      } else if (prep.hasInputTexture && feedbackTexture && feedbackSampler) {
        // Case B: prevFrame only (no iterations) — bind persistent texture directly
        const bindGroup = this.pipelineBuilder.createStandardBindGroup(
          prep.layout,
          prep.outputTexture,
          prep.dimensionsBuffer,
          prep.paramBuffer,
          feedbackTexture,
          feedbackSampler,
        );
        const executionContext = createExecutionContext(
          prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
        );
        await this.executor.execute(executionContext);
        // Copy output back to persistent feedback texture for next frame
        const copyEncoder = device.createCommandEncoder({ label: 'feedback-persist-copy' });
        copyEncoder.copyTextureToTexture(
          { texture: prep.outputTexture },
          { texture: feedbackTexture },
          [superDimensions.width, superDimensions.height]
        );
        device.queue.submit([copyEncoder.finish()]);
      } else if (prep.hasIterations) {
        // Case C: iterations only (no prevFrame) — existing behavior
        await executeFeedbackLoop(
          device,
          superDimensions,
          prep.iterations,
          prep.outputTexture,
          '',
          async (ctx) => {
            const bindGroup = this.pipelineBuilder.createStandardBindGroup(
              prep.layout,
              prep.outputTexture,
              prep.dimensionsBuffer,
              prep.paramBuffer,
              ctx.prevTexture,
              ctx.prevSampler,
            );
            const executionContext = createExecutionContext(
              prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
            );
            await this.executor.execute(executionContext);
          },
        );
      } else {
        // Case D: no prevFrame, no iterations — simple execution
        const bindGroup = this.pipelineBuilder.createStandardBindGroup(
          prep.layout,
          prep.outputTexture,
          prep.dimensionsBuffer,
          prep.paramBuffer,
        );
        const executionContext = createExecutionContext(
          prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
        );
        await this.executor.execute(executionContext);
      }
    });

    // Post-process (gamma/contrast) on GPU
    const processed = await withGPUErrorScope(device, 'animation post-process', async () => {
      return await this.gpuPostProcessor.applyGammaContrast(
        shaderId,
        prep.outputTexture,
        superDimensions,
        state.globalParams.gamma,
        state.globalParams.contrast,
      );
    });

    // Notify that a new frame is ready
    this.onFrameRendered(shaderId, processed.displayTexture);
  }
}
