/**
 * Video Exporter - Renders shader animations to MP4 using WebCodecs + mp4-muxer
 *
 * Uses GPU readback (texture → buffer → map) to capture frames, avoiding
 * unreliable VideoFrame-from-OffscreenCanvas path with WebGPU contexts.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { WebGPUContext } from '../engine/WebGPUContext';
import type { ShaderCompiler } from '../engine/ShaderCompiler';
import type { BufferManager } from '../engine/BufferManager';
import type { ParameterManager } from '../engine/ParameterManager';
import type { PipelineBuilder } from '../engine/PipelineBuilder';
import type { Executor } from '../engine/Executor';
import type { GPUPostProcessor } from '../engine/GPUPostProcessor';
import { prepareShader } from '../engine/ShaderPreparation';
import { createExecutionContext } from '../engine/Executor';
import { executeFeedbackLoop } from '../engine/FeedbackLoop';
import { withGPUErrorScope } from '../engine/GPUErrorHandler';
import type { ShaderDefinition } from '@/types/core';
import displayShaderSource from '../../shaders/utils/display.wgsl?raw';

export interface VideoExportConfig {
  shader: ShaderDefinition;
  shaderId: string;
  width: number;
  height: number;
  duration: number; // seconds
  fps: number;
  gamma: number;
  contrast: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Bitrate in Mbps (e.g. 8 = 8 Mbps) */
  bitrateMbps: number;
  parameterValues?: Map<string, number>;
  iterations?: number;
}

export interface VideoExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  currentFrame: number;
  totalFrames: number;
  /** Estimated seconds remaining */
  eta: number;
}

export type VideoExportProgressCallback = (progress: VideoExportProgress) => void;

export class VideoExporter {
  private context: WebGPUContext;
  private compiler: ShaderCompiler;
  private bufferManager: BufferManager;
  private parameterManager: ParameterManager;
  private pipelineBuilder: PipelineBuilder;
  private executor: Executor;
  private gpuPostProcessor: GPUPostProcessor;
  private cancelled = false;

  constructor(
    context: WebGPUContext,
    compiler: ShaderCompiler,
    bufferManager: BufferManager,
    parameterManager: ParameterManager,
    pipelineBuilder: PipelineBuilder,
    executor: Executor,
    gpuPostProcessor: GPUPostProcessor,
  ) {
    this.context = context;
    this.compiler = compiler;
    this.bufferManager = bufferManager;
    this.parameterManager = parameterManager;
    this.pipelineBuilder = pipelineBuilder;
    this.executor = executor;
    this.gpuPostProcessor = gpuPostProcessor;
  }

  static isSupported(): boolean {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  }

  cancel(): void {
    this.cancelled = true;
  }

  async export(
    config: VideoExportConfig,
    onProgress?: VideoExportProgressCallback,
  ): Promise<Blob> {
    this.cancelled = false;
    const totalFrames = Math.ceil(config.duration * config.fps);

    onProgress?.({
      phase: 'preparing',
      currentFrame: 0,
      totalFrames,
      eta: 0,
    });

    // Ensure output dimensions are even (H.264 requirement)
    const width = config.width % 2 === 0 ? config.width : config.width + 1;
    const height = config.height % 2 === 0 ? config.height : config.height + 1;

    const device = this.context.getDevice();

    // Supersample: 2x for low/medium bitrate, 3x for high+ quality
    // Cap to GPU's max texture dimension
    const maxDim = device.limits.maxTextureDimension2D;
    const desiredFactor = config.bitrateMbps <= 8 ? 2 : 3;
    const maxFactor = Math.floor(Math.min(maxDim / width, maxDim / height));
    const supersampleFactor = Math.max(1, Math.min(desiredFactor, maxFactor));
    const superWidth = width * supersampleFactor;
    const superHeight = height * supersampleFactor;

    // Prepare shader at supersampled resolution
    const prep = await prepareShader(
      this.compiler,
      this.bufferManager,
      this.parameterManager,
      this.pipelineBuilder,
      this.executor,
      this.context,
      () => config.iterations ?? config.shader.iterations ?? 1,
      () => config.parameterValues ?? new Map(config.shader.parameters.map(p => [p.name, p.default])),
      {
        shader: config.shader,
        shaderId: config.shaderId,
        dimensions: { width: superWidth, height: superHeight },
        zoom: config.zoom,
        panX: config.panX,
        panY: config.panY,
        labelSuffix: 'video',
        parameterValues: config.parameterValues,
        iterations: config.iterations,
        measureCompileTime: false,
      },
    );

    // --- Set up GPU readback pipeline (display texture → rgba8unorm → buffer) ---

    // Create display render pipeline (converts float display texture to rgba8unorm)
    const displayModule = device.createShaderModule({
      code: displayShaderSource,
      label: 'video-display-shader',
    });
    const displaySampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    const displayPipeline = device.createRenderPipeline({
      label: 'video-display-pipeline',
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vs_main' },
      fragment: {
        module: displayModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create rgba8unorm render target for format conversion
    const renderTarget = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      label: 'video-render-target',
    });

    // Create staging buffer for GPU readback (bytesPerRow must be 256-aligned)
    const bytesPerPixel = 4; // RGBA8
    const unalignedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
    const stagingBuffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'video-staging-buffer',
    });

    // Create feedback texture if needed (accumulate from scratch)
    let feedbackTexture: GPUTexture | undefined;
    let feedbackSampler: GPUSampler | undefined;
    if (prep.hasInputTexture) {
      feedbackTexture = device.createTexture({
        size: [superWidth, superHeight],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        label: 'video-feedback',
      });
      const clearEncoder = device.createCommandEncoder({ label: 'video-feedback-clear' });
      clearEncoder.beginRenderPass({
        colorAttachments: [{
          view: feedbackTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      }).end();
      device.queue.submit([clearEncoder.finish()]);

      feedbackSampler = device.createSampler({
        addressModeU: 'mirror-repeat',
        addressModeV: 'mirror-repeat',
        magFilter: 'nearest',
        minFilter: 'nearest',
      });
    }

    // --- Set up mp4-muxer + VideoEncoder ---

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    });

    // Track encoder errors — the error callback fires asynchronously
    let encoderError: string | null = null;

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta);
      },
      error: (err) => {
        console.error('VideoEncoder error:', err);
        encoderError = err instanceof Error ? err.message : String(err);
      },
    });

    // Pick H.264 level based on coded area (MaxFS in macroblocks, 1 MB = 16x16 = 256 px)
    // High Profile (0x64): L4.0 ≤8192 MB (2M px), L5.0 ≤22080 MB (5.6M px),
    // L5.1 ≤36864 MB (9.4M px), L5.2 ≤36864 MB (same area, higher bitrate)
    const codedArea = width * height;
    let avcLevel: string;
    if (codedArea <= 2_097_152) {
      avcLevel = '640028'; // L4.0
    } else if (codedArea <= 5_652_480) {
      avcLevel = '640032'; // L5.0
    } else if (codedArea <= 9_437_184) {
      avcLevel = '640033'; // L5.1
    } else {
      avcLevel = '640034'; // L5.2
    }

    videoEncoder.configure({
      codec: `avc1.${avcLevel}`,
      width,
      height,
      bitrate: config.bitrateMbps * 1_000_000,
      framerate: config.fps,
    });

    // Pre-allocate typed arrays for time/frame writes
    const timeData = new Float32Array(1);
    const frameData = new Uint32Array(1);

    const startTime = performance.now();

    try {
      onProgress?.({
        phase: 'rendering',
        currentFrame: 0,
        totalFrames,
        eta: 0,
      });

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (this.cancelled) {
          throw new Error('Export cancelled');
        }
        if (encoderError) {
          throw new Error(`Video encoding failed: ${encoderError}`);
        }

        const time = frameIndex / config.fps;

        // Write time and frame to dimensions buffer
        timeData[0] = time;
        device.queue.writeBuffer(prep.dimensionsBuffer, 24, timeData);
        frameData[0] = frameIndex + 1;
        device.queue.writeBuffer(prep.dimensionsBuffer, 28, frameData);

        // Execute shader (same 4 cases as AnimationController.renderFrame)
        await withGPUErrorScope(device, 'video frame', async () => {
          if (prep.hasInputTexture && prep.hasIterations && feedbackTexture && feedbackSampler) {
            await executeFeedbackLoop(
              device, { width: superWidth, height: superHeight }, prep.iterations, prep.outputTexture, 'video',
              async (ctx) => {
                const bindGroup = this.pipelineBuilder.createStandardBindGroup(
                  prep.layout, prep.outputTexture, prep.dimensionsBuffer, prep.paramBuffer,
                  ctx.prevTexture, ctx.prevSampler,
                );
                await this.executor.execute(createExecutionContext(
                  prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
                ));
              },
              feedbackTexture,
            );
          } else if (prep.hasInputTexture && feedbackTexture && feedbackSampler) {
            const bindGroup = this.pipelineBuilder.createStandardBindGroup(
              prep.layout, prep.outputTexture, prep.dimensionsBuffer, prep.paramBuffer,
              feedbackTexture, feedbackSampler,
            );
            await this.executor.execute(createExecutionContext(
              prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
            ));
          } else if (prep.hasIterations) {
            await executeFeedbackLoop(
              device, { width: superWidth, height: superHeight }, prep.iterations, prep.outputTexture, 'video',
              async (ctx) => {
                const bindGroup = this.pipelineBuilder.createStandardBindGroup(
                  prep.layout, prep.outputTexture, prep.dimensionsBuffer, prep.paramBuffer,
                  ctx.prevTexture, ctx.prevSampler,
                );
                await this.executor.execute(createExecutionContext(
                  prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
                ));
              },
            );
          } else {
            const bindGroup = this.pipelineBuilder.createStandardBindGroup(
              prep.layout, prep.outputTexture, prep.dimensionsBuffer, prep.paramBuffer,
            );
            await this.executor.execute(createExecutionContext(
              prep.pipeline, bindGroup, prep.workgroups, prep.outputTexture,
            ));
          }
        });

        // Copy output to feedback texture for next frame
        if (prep.hasInputTexture && feedbackTexture) {
          const copyEncoder = device.createCommandEncoder({ label: 'video-feedback-copy' });
          copyEncoder.copyTextureToTexture(
            { texture: prep.outputTexture },
            { texture: feedbackTexture },
            [superWidth, superHeight],
          );
          device.queue.submit([copyEncoder.finish()]);
        }

        // Post-process (gamma/contrast)
        const processed = await withGPUErrorScope(device, 'video post-process', async () => {
          return await this.gpuPostProcessor.applyGammaContrast(
            `video-${config.shaderId}`,
            prep.outputTexture,
            { width: superWidth, height: superHeight },
            { width, height },
            config.gamma,
            config.contrast,
          );
        });

        // Blit display texture to rgba8unorm render target via display shader
        const blitBindGroup = device.createBindGroup({
          label: 'video-display-bind-group',
          layout: displayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: processed.displayTexture.createView() },
            { binding: 1, resource: displaySampler },
          ],
        });

        const cmdEncoder = device.createCommandEncoder({ label: 'video-readback' });

        // Render pass: display texture → rgba8unorm
        const renderPass = cmdEncoder.beginRenderPass({
          label: 'video-display-pass',
          colorAttachments: [{
            view: renderTarget.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          }],
        });
        renderPass.setPipeline(displayPipeline);
        renderPass.setBindGroup(0, blitBindGroup);
        renderPass.draw(3);
        renderPass.end();

        // Copy render target to staging buffer
        cmdEncoder.copyTextureToBuffer(
          { texture: renderTarget },
          { buffer: stagingBuffer, bytesPerRow },
          { width, height },
        );

        device.queue.submit([cmdEncoder.finish()]);

        // Map staging buffer and read pixels
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const mappedRange = stagingBuffer.getMappedRange();

        // Strip row padding if bytesPerRow > width*4
        let framePixels: Uint8Array;
        if (bytesPerRow > unalignedBytesPerRow) {
          framePixels = new Uint8Array(width * height * bytesPerPixel);
          const src = new Uint8Array(mappedRange);
          for (let row = 0; row < height; row++) {
            framePixels.set(
              src.subarray(row * bytesPerRow, row * bytesPerRow + unalignedBytesPerRow),
              row * unalignedBytesPerRow,
            );
          }
        } else {
          // No padding — still need to copy since getMappedRange is detached on unmap
          framePixels = new Uint8Array(mappedRange.slice(0));
        }

        stagingBuffer.unmap();

        // Create VideoFrame from raw RGBA pixel data
        const timestamp = (frameIndex / config.fps) * 1_000_000; // microseconds
        const frameDuration = (1 / config.fps) * 1_000_000;
        const videoFrame = new VideoFrame(framePixels, {
          format: 'RGBA',
          codedWidth: width,
          codedHeight: height,
          timestamp,
          duration: frameDuration,
        });

        const keyFrame = frameIndex % (config.fps * 2) === 0;
        videoEncoder.encode(videoFrame, { keyFrame });
        videoFrame.close();

        // Report progress
        const elapsed = (performance.now() - startTime) / 1000;
        const framesPerSecond = (frameIndex + 1) / elapsed;
        const remainingFrames = totalFrames - frameIndex - 1;
        const eta = remainingFrames / Math.max(framesPerSecond, 0.1);

        onProgress?.({
          phase: 'rendering',
          currentFrame: frameIndex + 1,
          totalFrames,
          eta,
        });

        // Yield to browser every 4 frames to keep UI responsive
        if (frameIndex % 4 === 3) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Check for encoder errors before finalizing
      if (encoderError) {
        throw new Error(`Video encoding failed: ${encoderError}`);
      }

      // Finalize
      onProgress?.({
        phase: 'finalizing',
        currentFrame: totalFrames,
        totalFrames,
        eta: 0,
      });

      await videoEncoder.flush();
      videoEncoder.close();
      muxer.finalize();

      const buffer = target.buffer;
      return new Blob([buffer], { type: 'video/mp4' });
    } catch (err) {
      try { videoEncoder.close(); } catch { /* ignore */ }
      throw err;
    } finally {
      // Cleanup GPU resources
      feedbackTexture?.destroy();
      renderTarget.destroy();
      stagingBuffer.destroy();
      this.gpuPostProcessor.clearShaderTextures(`video-${config.shaderId}`);
    }
  }
}
