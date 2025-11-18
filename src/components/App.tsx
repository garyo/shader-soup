/**
 * Main App Component - Integrates WebGPU engine with UI
 */

import { type Component, onMount, createSignal, Show } from 'solid-js';
import { ShaderGrid } from './ShaderGrid';
import { Toolbar } from './Toolbar';
import { MashupToolbar } from './MashupToolbar';
import { MashupResults } from './MashupResults';
import { LogOverlay, type LogEntry } from './LogOverlay';
import WebGPUCheck from './WebGPUCheck';
import { shaderStore, inputStore, resultStore, evolutionStore } from '@/stores';
import { getWebGPUContext, WebGPUContext } from '@/core/engine/WebGPUContext';
import { ShaderCompiler } from '@/core/engine/ShaderCompiler';
import { BufferManager } from '@/core/engine/BufferManager';
import { ParameterManager } from '@/core/engine/ParameterManager';
import { PipelineBuilder } from '@/core/engine/PipelineBuilder';
import { Executor, createExecutionContext } from '@/core/engine/Executor';
import { CoordinateGenerator } from '@/core/input/CoordinateGenerator';
import { ResultRenderer } from '@/core/output/ResultRenderer';
import { PostProcessor } from '@/core/output/PostProcessor';
import { ShaderEvolver } from '@/core/llm';
import type { ShaderDefinition } from '@/types/core';

// Import example shader sources
import sineWaveSource from '../shaders/examples/sine-wave.wgsl?raw';
import colorMixerSource from '../shaders/examples/color-mixer.wgsl?raw';
import checkerboardSource from '../shaders/examples/checkerboard.wgsl?raw';
import radialGradientSource from '../shaders/examples/radial-gradient.wgsl?raw';
// Feedback disabled for now - complicates evolution and slows down rendering
// import feedbackSource from '../shaders/examples/feedback.wgsl?raw';

export const App: Component = () => {
  const [webgpuReady, setWebgpuReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [temperature, setTemperature] = createSignal(0.9); // Default evolution temperature
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [logOverlayOpen, setLogOverlayOpen] = createSignal(false);
  const [mashupInProgress, setMashupInProgress] = createSignal(false);

  const maxLogEntries = 32;
  // Add log entry to the overlay (at the end of the list)
  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => {
     const old = prev.slice(-(maxLogEntries-1));
     return [...old, { timestamp: new Date(), message, type }];
    });
  };

  // GPU downsampling is now handled in ResultRenderer

  // WebGPU components
  let context: WebGPUContext;
  let compiler: ShaderCompiler;
  let bufferManager: BufferManager;
  let parameterManager: ParameterManager;
  let pipelineBuilder: PipelineBuilder;
  let executor: Executor;
  let coordGenerator: CoordinateGenerator;
  let resultRenderer: ResultRenderer;
  let postProcessor: PostProcessor;
  let shaderEvolver: ShaderEvolver;

  // Initialize WebGPU and load example shaders
  onMount(async () => {
    try {
      // Initialize WebGPU
      context = await getWebGPUContext();

      // Create engine components
      compiler = new ShaderCompiler(context);
      bufferManager = new BufferManager(context);
      parameterManager = new ParameterManager(bufferManager);
      pipelineBuilder = new PipelineBuilder(context);
      executor = new Executor(context, true); // Enable profiling
      coordGenerator = new CoordinateGenerator();
      resultRenderer = new ResultRenderer(bufferManager, context);
      postProcessor = new PostProcessor(context, bufferManager);

      // Initialize LLM-based shader evolver
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      console.log('API Key check:', apiKey ? `Found (${apiKey.substring(0, 15)}...)` : 'NOT FOUND');
      console.log('All env vars:', import.meta.env);
      if (apiKey) {
        shaderEvolver = new ShaderEvolver(apiKey, compiler, parameterManager);
        console.log('ShaderEvolver initialized successfully');
      } else {
        console.warn('VITE_ANTHROPIC_API_KEY not set - evolution feature disabled');
      }

      setWebgpuReady(true);

      // Load promoted shaders from localStorage
      const promotedCount = shaderStore.loadPromotedShaders();
      console.log(`Loaded ${promotedCount} promoted shaders from localStorage`);

      // Load example shaders
      loadExampleShaders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize WebGPU');
    }
  });

  const loadExampleShaders = () => {
    // Clear existing example shaders before loading to prevent duplication on hot reload
    shaderStore.clearExampleShaders();

    const examples: Array<{ name: string; source: string; description: string }> = [
      {
        name: 'Sine Wave',
        source: sineWaveSource,
        description: 'Wave pattern with adjustable frequency and colors',
      },
      {
        name: 'Color Mixer',
        source: colorMixerSource,
        description: 'RGB gradient generator with multiple mix modes',
      },
      {
        name: 'Checkerboard',
        source: checkerboardSource,
        description: 'Rotatable checkerboard pattern',
      },
      {
        name: 'Radial Gradient',
        source: radialGradientSource,
        description: 'HSV-based radial gradient',
      },
      // Feedback disabled - complicates evolution, hard to get interesting results
      // {
      //   name: 'Feedback Loop',
      //   source: feedbackSource,
      //   description: 'Iterative diffusion with decay and injection (10 iterations)',
      // },
    ];

    for (const example of examples) {
      const params = parameterManager.parseParameters(example.source);
      const iterations = parameterManager.parseIterations(example.source);
      const shader: ShaderDefinition = {
        id: crypto.randomUUID(),
        name: example.name,
        cacheKey: example.name.toLowerCase().replace(/\s+/g, '-'), // e.g., "sine-wave"
        source: example.source,
        parameters: params,
        iterations: iterations,
        description: example.description,
        createdAt: new Date(),
        modifiedAt: new Date(),
      };

      shaderStore.addShader(shader);
    }

    // Execute all shaders
    executeAllShaders();
  };

  const executeShader = async (shaderId: string, shaderOverride?: ShaderDefinition) => {
    try {
      // Use provided shader or look up from store
      const shader = shaderOverride || shaderStore.getShader(shaderId);
      if (!shader) return;

      const dimensions = inputStore.outputDimensions;

      // Supersample at 3x for antialiasing
      const supersampleFactor = 3;
      const superDimensions = {
        width: dimensions.width * supersampleFactor,
        height: dimensions.height * supersampleFactor,
      };

      // Get global parameters for zoom/pan
      const globalParams = shaderStore.getGlobalParameters(shaderId);

      // Create coordinate texture and sampler at supersampled resolution with zoom/pan applied
      const coordTexture = await coordGenerator.createCoordinateTexture(
        superDimensions,
        context,
        globalParams.zoom,
        globalParams.panX,
        globalParams.panY
      );
      const coordSampler = coordGenerator.createCoordinateSampler(context);

      // Create output buffer at supersampled resolution (RGBA format: 4 bytes per pixel)
      const outputSize = superDimensions.width * superDimensions.height * 4 * 4; // vec4<f32> = 16 bytes per pixel
      const outputBuffer = bufferManager.createBuffer(
        {
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          label: 'output',
        },
        false
      );

      // Compile shader (use cacheKey for internal caching)
      const startCompile = performance.now();
      const compilationResult = await compiler.compile(shader.source, shader.cacheKey);

      if (!compilationResult.success || !compilationResult.module) {
        throw new Error(`Compilation failed: ${ShaderCompiler.formatErrors(compilationResult.errors)}`);
      }

      const compileTime = performance.now() - startCompile;

      // Create dimensions buffer (always required)
      const dimensionsData = new Uint32Array([superDimensions.width, superDimensions.height, 0, 0]);
      const dimensionsBuffer = bufferManager.createBufferWithData(
        dimensionsData as BufferSource,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'dimensions'
      );

      // Create parameter buffer if shader has parameters
      let paramBuffer: GPUBuffer | undefined;
      if (shader.parameters.length > 0) {
        // Use shader defaults if not in store (for children)
        const paramValues = shaderOverride
          ? new Map(shader.parameters.map(p => [p.name, p.default]))
          : shaderStore.getParameterValues(shaderId);
        paramBuffer = parameterManager.createParameterBuffer(shader.parameters, paramValues);
      }

      // Check if shader uses iterations (feedback loop)
      // Use stored iteration value if available, otherwise use shader default
      const iterations = shaderStore.getIterationValue(shaderId) ?? shader.iterations ?? 1;
      const hasIterations = iterations > 1;
      const hasParams = shader.parameters.length > 0;

      // Create bind group layout (with prevFrame support if iterations > 1)
      const layout = pipelineBuilder.createStandardLayout(hasParams, hasIterations, shader.cacheKey);

      // Create pipeline
      const pipeline = pipelineBuilder.createPipeline({
        shader: compilationResult.module,
        entryPoint: 'main',
        bindGroupLayouts: [layout],
        label: shader.cacheKey,
      });

      const workgroups = executor.calculateWorkgroups(superDimensions.width, superDimensions.height);
      const startExec = performance.now();

      // Push error scopes for shader execution
      const device = context.getDevice();
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      if (hasIterations) {
        // Feedback loop: create two textures for ping-pong
        const textureA = device.createTexture({
          size: [superDimensions.width, superDimensions.height],
          format: 'rgba32float', // Use rgba32float to match buffer format
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          label: 'feedback-texture-A',
        });
        const textureB = device.createTexture({
          size: [superDimensions.width, superDimensions.height],
          format: 'rgba32float', // Use rgba32float to match buffer format
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          label: 'feedback-texture-B',
        });

        // Initialize textureB to black/zero for first iteration
        // rgba32float uses 16 bytes per pixel (4 channels * 4 bytes each)
        const zeroData = new Float32Array(superDimensions.width * superDimensions.height * 4);
        device.queue.writeTexture(
          { texture: textureB },
          zeroData,
          { bytesPerRow: superDimensions.width * 16 },
          [superDimensions.width, superDimensions.height]
        );

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

          // Create bind group for this iteration (always include prevFrame, even on first iteration)
          const bindGroup = pipelineBuilder.createStandardBindGroup(
            layout,
            coordTexture,
            coordSampler,
            outputBuffer,
            dimensionsBuffer,
            paramBuffer,
            prevTexture, // Always provide prevTexture (black on first iteration)
            prevSampler
          );

          // Execute compute shader to current texture storage binding
          // Note: We're still writing to outputBuffer, but we'll copy it to texture after
          const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
          await executor.execute(executionContext);

          // Copy output buffer to current texture for next iteration (unless last)
          if (!isLastIter) {
            const commandEncoder = device.createCommandEncoder();
            commandEncoder.copyBufferToTexture(
              { buffer: outputBuffer, bytesPerRow: superDimensions.width * 16 }, // Output buffer is vec4<f32> = 16 bytes per pixel
              { texture: currentTexture }, // Texture is rgba16float = 8 bytes per pixel (GPU handles conversion)
              [superDimensions.width, superDimensions.height]
            );
            device.queue.submit([commandEncoder.finish()]);
            await device.queue.onSubmittedWorkDone();
          }
        }

        // Cleanup textures
        textureA.destroy();
        textureB.destroy();
      } else {
        // Single execution (no iterations)
        const bindGroup = pipelineBuilder.createStandardBindGroup(
          layout,
          coordTexture,
          coordSampler,
          outputBuffer,
          dimensionsBuffer,
          paramBuffer
        );

        const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
        await executor.execute(executionContext);
      }

      const execTime = performance.now() - startExec;

      // Check for GPU errors during shader execution
      const execMemError = await device.popErrorScope();
      if (execMemError) {
        throw new Error(`GPU out-of-memory during shader execution: ${execMemError.message}`);
      }
      const execValError = await device.popErrorScope();
      if (execValError) {
        throw new Error(`GPU validation error during shader execution: ${execValError.message}`);
      }

      // Apply gamma/contrast post-processing (in linear RGB space)
      const postProcessStart = performance.now();
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      const processedBuffer = await postProcessor.applyGammaContrast(
        outputBuffer,
        superDimensions,
        globalParams.gamma,
        globalParams.contrast
      );

      const postMemError = await device.popErrorScope();
      if (postMemError) {
        throw new Error(`GPU out-of-memory during post-processing: ${postMemError.message}`);
      }
      const postValError = await device.popErrorScope();
      if (postValError) {
        throw new Error(`GPU validation error during post-processing: ${postValError.message}`);
      }

      const postProcessTime = performance.now() - postProcessStart;

      // Downsample on GPU, then convert to ImageData
      const downsampleStart = performance.now();
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      const downsampledBuffer = resultRenderer.downsample(processedBuffer, superDimensions, dimensions, supersampleFactor);
      const imageData = await resultRenderer.bufferToImageData(downsampledBuffer, dimensions);

      const downMemError = await device.popErrorScope();
      if (downMemError) {
        throw new Error(`GPU out-of-memory during downsampling: ${downMemError.message}`);
      }
      const downValError = await device.popErrorScope();
      if (downValError) {
        throw new Error(`GPU validation error during downsampling: ${downValError.message}`);
      }

      const downsampleTime = performance.now() - downsampleStart;

      const totalTime = compileTime + execTime + postProcessTime + downsampleTime;

      // Log execution time
      addLog(
        `Rendered "${shader.name}": compile ${compileTime.toFixed(1)}ms + exec ${execTime.toFixed(1)}ms + post ${postProcessTime.toFixed(1)}ms + downsample ${downsampleTime.toFixed(1)}ms = ${totalTime.toFixed(1)}ms (${superDimensions.width}x${superDimensions.height} → ${dimensions.width}x${dimensions.height})`
      );

      // Update result store
      resultStore.updateResult({
        shaderId,
        imageData,
        executionTime: totalTime,
        timestamp: new Date(),
      });

      resultStore.clearError(shaderId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      resultStore.setError(shaderId, errorMessage);
      console.error(`Shader ${shaderId} execution failed:`, err);
    }
  };

  const executeAllShaders = async () => {
    resultStore.setProcessing(true);
    const activeShaders = shaderStore.getActiveShaders();

    for (const shader of activeShaders) {
      await executeShader(shader.id);
    }

    resultStore.setProcessing(false);
  };

  const handleParameterChange = (shaderId: string, paramName: string, value: number) => {
    shaderStore.updateParameter(shaderId, paramName, value);
    // Re-execute shader with new parameters
    executeShader(shaderId);
  };

  const handleIterationChange = (shaderId: string, value: number) => {
    shaderStore.updateIterationValue(shaderId, value);
    // Re-execute shader with new iteration count
    executeShader(shaderId);
  };

  const handleGlobalParameterChange = (shaderId: string, paramName: keyof import('@/stores/shaderStore').GlobalParameters, value: number) => {
    shaderStore.updateGlobalParameter(shaderId, paramName, value);
    // Re-execute shader with new global parameters
    executeShader(shaderId);
  };

  const handleGlobalParametersReset = (shaderId: string) => {
    shaderStore.resetGlobalParameters(shaderId);
    // Re-execute shader with reset parameters
    executeShader(shaderId);
  };

  const handleEvolve = async (shaderId: string) => {
    if (!shaderEvolver) {
      alert('Evolution feature requires VITE_ANTHROPIC_API_KEY environment variable');
      return;
    }

    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

    // Bake current parameter values as defaults for evolution
    const currentParamValues = shaderStore.getParameterValues(shaderId);
    const shaderWithBakedParams: ShaderDefinition = {
      ...shader,
      parameters: shader.parameters.map(param => {
        const currentValue = currentParamValues?.get(param.name);
        if (currentValue !== undefined) {
          return { ...param, default: currentValue };
        }
        return param;
      }),
    };

    // Start evolution
    const childrenCount = 6;
    const currentTemp = temperature(); // Get current temperature from signal
    evolutionStore.startEvolution(shaderId, shader.name, childrenCount, currentTemp);

    addLog(`Starting evolution of "${shader.name}" (temp: ${currentTemp.toFixed(2)}, children: ${childrenCount})`);

    try {
      // Update progress: generating batch
      evolutionStore.updateProgress(shaderId, {
        currentChild: 0,
        status: 'mutating',
        debugAttempt: 0,
      });

      addLog(`Generating ${childrenCount} shader variations...`);

      // Evolve all children in one batch call with current temperature and baked params
      const results = await shaderEvolver.evolveShaderBatch(shaderWithBakedParams, childrenCount, currentTemp);

      addLog(`Received ${results.length} variations, processing...`, 'success');

      // Process each result
      for (let i = 0; i < results.length; i++) {
        const result = results[i];

        evolutionStore.updateProgress(shaderId, {
          currentChild: i + 1,
          status: result.success ? 'naming' : 'mutating',
          debugAttempt: result.debugAttempts || 0,
        });

        if (result.success && result.shader) {
          addLog(`✓ Child ${i + 1}/${childrenCount} compiled successfully (${result.debugAttempts || 0} debug attempts)`);

          // Add child to evolution store (NOT main shader store)
          evolutionStore.addChild(shaderId, result.shader);

          // Execute child shader to generate ImageData (but don't add to main grid)
          await executeShader(result.shader.id, result.shader);
        } else {
          addLog(`✗ Child ${i + 1}/${childrenCount} failed: ${result.error}`, 'error');
          console.warn(`Failed to evolve child ${i + 1}:`, result.error);
          evolutionStore.updateProgress(shaderId, {
            lastError: result.error,
          });
        }
      }

      addLog(`Evolution complete: ${results.filter(r => r.success).length}/${childrenCount} succeeded`, 'success');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown batch evolution error';
      addLog(`Evolution failed: ${errorMsg}`, 'error');
      console.error('Batch evolution error:', error);
      evolutionStore.updateProgress(shaderId, {
        lastError: errorMsg,
      });
    }

    // Complete evolution
    evolutionStore.completeEvolution(shaderId);
  };

  const handleCancelEvolution = (shaderId: string) => {
    evolutionStore.cancelEvolution(shaderId);
  };

  const handlePromoteChild = (child: ShaderDefinition) => {
    // Add child to main shader store as promoted (persists to localStorage)
    shaderStore.addPromotedShader(child);
    // Execute the shader to display it
    executeShader(child.id);
  };

  const handleMashupToggle = (shaderId: string) => {
    shaderStore.toggleMashupSelection(shaderId);
  };

  const handleDeleteShader = (shaderId: string) => {
    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

    // Confirm deletion
    if (confirm(`Delete shader "${shader.name}"? This cannot be undone.`)) {
      shaderStore.removePromotedShader(shaderId);
      resultStore.clearError(shaderId);
      addLog(`Deleted shader "${shader.name}"`);
    }
  };

  const handleDownloadShader = async (shaderId: string) => {
    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

    addLog(`Rendering high-res version of "${shader.name}"...`);

    try {
      // High-res dimensions: 2048x2048
      const hiResDimensions = { width: 2048, height: 2048 };

      // Supersample at 3x for antialiasing
      const supersampleFactor = 3;
      const superDimensions = {
        width: hiResDimensions.width * supersampleFactor,
        height: hiResDimensions.height * supersampleFactor,
      };

      // Get global parameters
      const globalParams = shaderStore.getGlobalParameters(shaderId);

      // Get device for error scopes
      const device = context.getDevice();

      // Create coordinate texture with zoom/pan
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      const coordTexture = await coordGenerator.createCoordinateTexture(
        superDimensions,
        context,
        globalParams.zoom,
        globalParams.panX,
        globalParams.panY
      );

      const memError = await device.popErrorScope();
      if (memError) {
        throw new Error(`GPU out-of-memory creating coordinate texture: ${memError.message}`);
      }
      const valError = await device.popErrorScope();
      if (valError) {
        throw new Error(`GPU validation error creating coordinate texture: ${valError.message}`);
      }

      const coordSampler = coordGenerator.createCoordinateSampler(context);

      // Create output buffer
      const outputSize = superDimensions.width * superDimensions.height * 4 * 4;
      const outputBuffer = bufferManager.createBuffer(
        {
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          label: 'output-hires',
        },
        false
      );

      // Compile shader
      const compilationResult = await compiler.compile(shader.source, shader.cacheKey);
      if (!compilationResult.success || !compilationResult.module) {
        throw new Error(`Compilation failed: ${ShaderCompiler.formatErrors(compilationResult.errors)}`);
      }

      // Create dimensions buffer
      const dimensionsData = new Uint32Array([superDimensions.width, superDimensions.height, 0, 0]);
      const dimensionsBuffer = bufferManager.createBufferWithData(
        dimensionsData as BufferSource,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'dimensions-hires'
      );

      // Create parameter buffer if shader has parameters
      let paramBuffer: GPUBuffer | undefined;
      if (shader.parameters.length > 0) {
        const paramValues = shaderStore.getParameterValues(shaderId);
        paramBuffer = parameterManager.createParameterBuffer(shader.parameters, paramValues);
      }

      // Get iteration value
      const iterations = shaderStore.getIterationValue(shaderId) ?? shader.iterations ?? 1;
      const hasIterations = iterations > 1;
      const hasParams = shader.parameters.length > 0;

      // Create bind group layout and pipeline (reuse same cache key as preview)
      const layout = pipelineBuilder.createStandardLayout(hasParams, hasIterations, shader.cacheKey);
      const pipeline = pipelineBuilder.createPipeline({
        shader: compilationResult.module,
        entryPoint: 'main',
        bindGroupLayouts: [layout],
        label: shader.cacheKey,
      });

      const workgroups = executor.calculateWorkgroups(superDimensions.width, superDimensions.height);

      addLog(`Rendering at ${superDimensions.width}x${superDimensions.height}...`);

      // Push error scopes for shader execution
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      // Execute shader (with iterations if needed)
      if (hasIterations) {
        const textureA = device.createTexture({
          size: [superDimensions.width, superDimensions.height],
          format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          label: 'feedback-texture-A-hires',
        });
        const textureB = device.createTexture({
          size: [superDimensions.width, superDimensions.height],
          format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          label: 'feedback-texture-B-hires',
        });

        const zeroData = new Float32Array(superDimensions.width * superDimensions.height * 4);
        device.queue.writeTexture(
          { texture: textureB },
          zeroData,
          { bytesPerRow: superDimensions.width * 16 },
          [superDimensions.width, superDimensions.height]
        );

        const prevSampler = device.createSampler({
          addressModeU: 'mirror-repeat',
          addressModeV: 'mirror-repeat',
          magFilter: 'nearest',
          minFilter: 'nearest',
        });

        for (let iter = 0; iter < iterations; iter++) {
          const isLastIter = iter === iterations - 1;
          const currentTexture = iter % 2 === 0 ? textureA : textureB;
          const prevTexture = iter % 2 === 0 ? textureB : textureA;

          const bindGroup = pipelineBuilder.createStandardBindGroup(
            layout,
            coordTexture,
            coordSampler,
            outputBuffer,
            dimensionsBuffer,
            paramBuffer,
            prevTexture,
            prevSampler
          );

          const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
          await executor.execute(executionContext);

          if (!isLastIter) {
            const commandEncoder = device.createCommandEncoder();
            commandEncoder.copyBufferToTexture(
              { buffer: outputBuffer, bytesPerRow: superDimensions.width * 16 },
              { texture: currentTexture },
              [superDimensions.width, superDimensions.height]
            );
            device.queue.submit([commandEncoder.finish()]);
            await device.queue.onSubmittedWorkDone();
          }
        }

        textureA.destroy();
        textureB.destroy();
      } else {
        const bindGroup = pipelineBuilder.createStandardBindGroup(
          layout,
          coordTexture,
          coordSampler,
          outputBuffer,
          dimensionsBuffer,
          paramBuffer
        );

        const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
        await executor.execute(executionContext);
      }

      // CRITICAL: Wait for shader execution to complete
      await context.getDevice().queue.onSubmittedWorkDone();

      // Check for GPU errors during shader execution
      const execMemError = await device.popErrorScope();
      if (execMemError) {
        throw new Error(`GPU out-of-memory during shader execution: ${execMemError.message}`);
      }
      const execValError = await device.popErrorScope();
      if (execValError) {
        throw new Error(`GPU validation error during shader execution: ${execValError.message}`);
      }

      // Apply gamma/contrast post-processing
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      const processedBuffer = await postProcessor.applyGammaContrast(
        outputBuffer,
        superDimensions,
        globalParams.gamma,
        globalParams.contrast
      );

      const postMemError = await device.popErrorScope();
      if (postMemError) {
        throw new Error(`GPU out-of-memory during post-processing: ${postMemError.message}`);
      }
      const postValError = await device.popErrorScope();
      if (postValError) {
        throw new Error(`GPU validation error during post-processing: ${postValError.message}`);
      }

      // Downsample to final resolution
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');

      const downsampledBuffer = resultRenderer.downsample(
        processedBuffer,
        superDimensions,
        hiResDimensions,
        supersampleFactor
      );

      const downMemError = await device.popErrorScope();
      if (downMemError) {
        throw new Error(`GPU out-of-memory during downsampling: ${downMemError.message}`);
      }
      const downValError = await device.popErrorScope();
      if (downValError) {
        throw new Error(`GPU validation error during downsampling: ${downValError.message}`);
      }

      // Wait for all GPU work to complete before downloading
      await context.getDevice().queue.onSubmittedWorkDone();

      // Download as PNG
      const filename = `${shader.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${hiResDimensions.width}x${hiResDimensions.height}.png`;
      await resultRenderer.downloadImage(downsampledBuffer, hiResDimensions, filename, 'image/png');

      addLog(`Downloaded "${filename}"`, 'success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Download failed: ${errorMessage}`, 'error');
      console.error('Download error:', err);
    }
  };

  const handleMashup = async () => {
    if (!shaderEvolver) {
      alert('Mashup feature requires VITE_ANTHROPIC_API_KEY environment variable');
      return;
    }

    const selectedShaders = shaderStore.getMashupSelected();
    if (selectedShaders.length < 2) {
      alert('Please select at least 2 shaders for mashup');
      return;
    }

    const mashupCount = 6;
    const currentTemp = temperature(); // Use current temperature
    const parentNames = selectedShaders.map(s => s.name);

    setMashupInProgress(true);
    addLog(`Starting mashup of ${selectedShaders.length} shaders: ${parentNames.join(', ')} (temp: ${currentTemp.toFixed(2)}, variants: ${mashupCount})`);

    try {
      // Generate mashup variations
      const results = await shaderEvolver.evolveMashup(selectedShaders, mashupCount, currentTemp);

      addLog(`Received ${results.length} mashup variations, processing...`, 'success');

      // Clear previous mashup results
      evolutionStore.clearMashupResults();

      // Process each mashup result
      for (let i = 0; i < results.length; i++) {
        const result = results[i];

        if (result.success && result.shader) {
          addLog(`✓ Mashup ${i + 1}/${mashupCount} compiled successfully`);

          // Add to mashup results
          evolutionStore.addMashupResult(result.shader);

          // Execute mashup shader to generate ImageData
          await executeShader(result.shader.id, result.shader);
        } else {
          addLog(`✗ Mashup ${i + 1}/${mashupCount} failed: ${result.error}`, 'error');
          console.warn(`Failed to create mashup ${i + 1}:`, result.error);
        }
      }

      // Update mashup results with parent names
      evolutionStore.setMashupResults(
        evolutionStore.getMashupResults(),
        parentNames
      );

      addLog(`Mashup complete: ${results.filter(r => r.success).length}/${mashupCount} succeeded`, 'success');

      // Scroll to mashup results
      setTimeout(() => {
        const mashupSection = document.querySelector('.mashup-results');
        if (mashupSection) {
          mashupSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown mashup error';
      addLog(`Mashup failed: ${errorMsg}`, 'error');
      console.error('Mashup error:', error);
    } finally {
      setMashupInProgress(false);
    }
  };

  const handleClearMashupSelection = () => {
    shaderStore.clearMashupSelection();
  };

  const handleClearMashupResults = () => {
    evolutionStore.clearMashupResults();
  };

  // Note: We don't need a reactive effect to re-execute all shaders on every store change.
  // All shader executions are handled explicitly:
  // - loadExampleShaders() calls executeAllShaders()
  // - handleParameterChange() calls executeShader(shaderId)
  // - handleGlobalParameterChange() calls executeShader(shaderId)
  // - handlePromoteChild() calls executeShader(shaderId)
  // This prevents unwanted re-execution of all shaders when only one shader's parameters change.

  return (
    <div class="app">
      <header class="app-header">
        <h1>Evolve Image Gen</h1>
        <p>WebGPU Shader Evolution Platform</p>
      </header>

      <Show when={!webgpuReady()} fallback={null}>
        <WebGPUCheck />
      </Show>

      <Show when={error()}>
        <div class="app-error">
          <h2>Error</h2>
          <p>{error()}</p>
        </div>
      </Show>

      <Show when={webgpuReady() && !error()}>
        <main class="app-main">
          <div class="app-info">
            <p>
              Below are example shaders running in real-time. Adjust the parameters to see changes
              instantly!
            </p>
          </div>

          <Toolbar
            temperature={temperature()}
            onTemperatureChange={setTemperature}
          />

          <ShaderGrid
            shaders={shaderStore.getActiveShaders()}
            onParameterChange={handleParameterChange}
            onIterationChange={handleIterationChange}
            onGlobalParameterChange={handleGlobalParameterChange}
            onGlobalParametersReset={handleGlobalParametersReset}
            onEvolve={handleEvolve}
            onCancelEvolution={handleCancelEvolution}
            onPromoteChild={handlePromoteChild}
            onMashupToggle={handleMashupToggle}
            onDeleteShader={handleDeleteShader}
            onDownloadShader={handleDownloadShader}
          />

          <Show when={evolutionStore.getMashupResults().length > 0}>
            <MashupResults
              mashups={evolutionStore.getMashupResults()}
              parentNames={evolutionStore.getMashupParentNames()}
              onPromote={handlePromoteChild}
              onClear={handleClearMashupResults}
            />
          </Show>

          <Show when={resultStore.isProcessing}>
            <div class="processing-indicator">Processing...</div>
          </Show>
        </main>
      </Show>

      <MashupToolbar
        onMashup={handleMashup}
        onClear={handleClearMashupSelection}
        isLoading={mashupInProgress()}
      />

      <LogOverlay
        logs={logs()}
        isOpen={logOverlayOpen()}
        onToggle={() => setLogOverlayOpen(!logOverlayOpen())}
      />
    </div>
  );
};
