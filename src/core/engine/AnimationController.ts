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

export interface FrameProfile {
  shaderId: string;
  shaderName: string;
  frameNumber: number;
  shaderExecMs: number;
  feedbackCopyMs: number;
  postProcessMs: number;
  totalFrameMs: number;
  iterations: number;
  superWidth: number;
  superHeight: number;
  executionCase: 'A' | 'B' | 'C' | 'D';
}

export interface AnimationState {
  /** Cached preparation result */
  prep: ShaderPreparationResult;
  /** Shader ID */
  shaderId: string;
  /** Shader display name */
  shaderName: string;
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
  /** Pre-allocated typed arrays for per-frame uniform writes */
  timeData: Float32Array;
  frameData: Uint32Array;
  /** Adaptive supersample: track slow frames during the first second */
  slowFrameCount: number;
  slowFrameCheckDone: boolean;
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
  private _onFrameProfile?: (profile: FrameProfile) => void;
  private _onRequestDownsample?: (shaderId: string) => void;
  profilingEnabled = false;

  /** Slow-frame threshold in ms */
  private static readonly SLOW_FRAME_MS = 100;
  /** How many slow frames before requesting downsample */
  private static readonly SLOW_FRAME_TRIGGER = 3;
  /** Stop checking after this many frames */
  private static readonly SLOW_FRAME_CHECK_WINDOW = 30;

  constructor(
    context: WebGPUContext,
    pipelineBuilder: PipelineBuilder,
    executor: Executor,
    gpuPostProcessor: GPUPostProcessor,
    onFrameRendered: OnFrameRendered,
    onFrameProfile?: (profile: FrameProfile) => void,
    onRequestDownsample?: (shaderId: string) => void,
  ) {
    this.context = context;
    this.pipelineBuilder = pipelineBuilder;
    this.executor = executor;
    this.gpuPostProcessor = gpuPostProcessor;
    this.onFrameRendered = onFrameRendered;
    this._onFrameProfile = onFrameProfile;
    this._onRequestDownsample = onRequestDownsample;
  }

  setProfilingEnabled(enabled: boolean): void {
    this.profilingEnabled = enabled;
  }

  /**
   * Get the elapsed animation time for a shader (seconds).
   * Returns 0 if the shader is not animating.
   */
  getElapsedTime(shaderId: string): number {
    const state = this.animations.get(shaderId);
    if (!state) return 0;
    return (performance.now() - state.startTime) / 1000.0;
  }

  /**
   * Start animating a shader with cached preparation result
   * @param timeOffset - Optional time offset in seconds to resume from (preserves animation continuity)
   */
  startAnimation(
    shaderId: string,
    prep: ShaderPreparationResult,
    superDimensions: { width: number; height: number },
    displayDimensions: { width: number; height: number },
    globalParams: { gamma: number; contrast: number },
    timeOffset: number = 0,
    shaderName: string = '',
  ): void {
    // Stop any existing animation for this shader (also cleans up feedback textures)
    this.stopAnimation(shaderId);

    // Create persistent feedback texture if shader uses prevFrame
    if (prep.hasInputTexture) {
      const device = this.context.getDevice();
      const feedbackTexture = device.createTexture({
        size: [superDimensions.width, superDimensions.height],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        label: `feedback-persistent-${shaderId}`,
      });
      // Initialize to black using GPU clear pass (avoids 36MB CPU allocation)
      const clearEncoder = device.createCommandEncoder({ label: 'feedback-clear' });
      clearEncoder.beginRenderPass({
        colorAttachments: [{
          view: feedbackTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      }).end();
      device.queue.submit([clearEncoder.finish()]);
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
      shaderName,
      rafId: 0,
      startTime: performance.now() - timeOffset * 1000,
      frameCount: 0,
      superDimensions,
      displayDimensions,
      globalParams,
      timeData: new Float32Array(1),
      frameData: new Uint32Array(1),
      slowFrameCount: 0,
      slowFrameCheckDone: false,
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
    // Clean up feedback textures. The animation frame was cancelled above,
    // so no further renderFrame calls will reference these.
    const feedbackTexture = this.feedbackTextures.get(shaderId);
    if (feedbackTexture) {
      this.feedbackTextures.delete(shaderId);
      this.feedbackSamplers.delete(shaderId);
      feedbackTexture.destroy();
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
   * Reset animation time to 0 and clear feedback texture to black.
   */
  resetAnimation(shaderId: string): void {
    const state = this.animations.get(shaderId);
    if (!state) return;

    // Reset time
    state.startTime = performance.now();
    state.frameCount = 0;

    // Clear feedback texture to black using GPU clear pass
    const feedbackTexture = this.feedbackTextures.get(shaderId);
    if (feedbackTexture) {
      const device = this.context.getDevice();
      const clearEncoder = device.createCommandEncoder({ label: 'feedback-reset-clear' });
      clearEncoder.beginRenderPass({
        colorAttachments: [{
          view: feedbackTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      }).end();
      device.queue.submit([clearEncoder.finish()]);
    }
  }

  /**
   * Reset all running animations.
   */
  resetAll(): void {
    for (const shaderId of this.animations.keys()) {
      this.resetAnimation(shaderId);
    }
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
    let device: GPUDevice;
    try {
      device = this.context.getDevice();
    } catch {
      // Device lost — stop this animation silently
      this.animations.delete(shaderId);
      return;
    }
    const profiling = this.profilingEnabled;

    const frameStart = performance.now();

    // Update time and frame in the dimensions buffer
    const elapsed = (performance.now() - state.startTime) / 1000.0; // seconds
    state.frameCount++;

    // Write time (f32) at offset 24 (field index 6) — reuse pre-allocated array
    state.timeData[0] = elapsed;
    device.queue.writeBuffer(prep.dimensionsBuffer, 24, state.timeData as unknown as Float32Array<ArrayBuffer>);

    // Write frame (u32) at offset 28 (field index 7) — reuse pre-allocated array
    state.frameData[0] = state.frameCount;
    device.queue.writeBuffer(prep.dimensionsBuffer, 28, state.frameData as unknown as Uint32Array<ArrayBuffer>);

    // Execute shader
    const feedbackTexture = this.feedbackTextures.get(shaderId);
    const feedbackSampler = this.feedbackSamplers.get(shaderId);

    let executionCase: 'A' | 'B' | 'C' | 'D' = 'D';
    const execStart = profiling ? performance.now() : 0;

    await withGPUErrorScope(device, 'animation frame', async () => {
      if (prep.hasInputTexture && prep.hasIterations && feedbackTexture && feedbackSampler) {
        // Case A: prevFrame + iterations — run feedback loop seeded from persistent texture
        executionCase = 'A';
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
      } else if (prep.hasInputTexture && feedbackTexture && feedbackSampler) {
        // Case B: prevFrame only (no iterations) — bind persistent texture directly
        executionCase = 'B';
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
      } else if (prep.hasIterations) {
        // Case C: iterations only (no prevFrame) — existing behavior
        executionCase = 'C';
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
        executionCase = 'D';
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

    const execEnd = profiling ? performance.now() : 0;

    // Copy feedback texture (Cases A & B)
    const copyStart = profiling ? performance.now() : 0;
    if (prep.hasInputTexture && feedbackTexture && this.feedbackTextures.has(shaderId)) {
      const copyEncoder = device.createCommandEncoder({ label: 'feedback-persist-copy' });
      copyEncoder.copyTextureToTexture(
        { texture: prep.outputTexture },
        { texture: feedbackTexture },
        [superDimensions.width, superDimensions.height]
      );
      device.queue.submit([copyEncoder.finish()]);
    }
    const copyEnd = profiling ? performance.now() : 0;

    // Post-process (gamma/contrast) on GPU
    const postStart = profiling ? performance.now() : 0;
    const processed = await withGPUErrorScope(device, 'animation post-process', async () => {
      return await this.gpuPostProcessor.applyGammaContrast(
        shaderId,
        prep.outputTexture,
        superDimensions,
        state.globalParams.gamma,
        state.globalParams.contrast,
      );
    });
    const postEnd = profiling ? performance.now() : 0;

    // Notify that a new frame is ready
    this.onFrameRendered(shaderId, processed.displayTexture);

    // Emit profiling data
    const frameMs = performance.now() - frameStart;
    if (profiling && this._onFrameProfile) {
      const profile: FrameProfile = {
        shaderId,
        shaderName: state.shaderName,
        frameNumber: state.frameCount,
        shaderExecMs: execEnd - execStart,
        feedbackCopyMs: copyEnd - copyStart,
        postProcessMs: postEnd - postStart,
        totalFrameMs: frameMs,
        iterations: prep.iterations,
        superWidth: superDimensions.width,
        superHeight: superDimensions.height,
        executionCase,
      };
      this._onFrameProfile(profile);
    }

    // Adaptive supersample: detect slow frames during early frames and request downsample
    if (!state.slowFrameCheckDone && this._onRequestDownsample) {
      if (state.frameCount <= AnimationController.SLOW_FRAME_CHECK_WINDOW) {
        if (frameMs > AnimationController.SLOW_FRAME_MS) {
          state.slowFrameCount++;
        }
        if (state.slowFrameCount >= AnimationController.SLOW_FRAME_TRIGGER) {
          state.slowFrameCheckDone = true;
          console.log(`[Perf] "${state.shaderName}" averaging ${frameMs.toFixed(0)}ms/frame at ${superDimensions.width}x${superDimensions.height} — requesting downsample`);
          // Defer to next event loop turn so the animation loop's .then() completes first
          const cb = this._onRequestDownsample;
          setTimeout(() => cb(shaderId), 0);
        }
      } else {
        state.slowFrameCheckDone = true;
      }
    }
  }
}
