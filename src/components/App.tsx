/**
 * Main App Component - Integrates WebGPU engine with UI
 */

import { type Component, onMount, onCleanup, createSignal, createEffect, on, Show } from 'solid-js';
import { ShaderGrid } from './ShaderGrid';
import { Toolbar } from './Toolbar';
import { MashupToolbar } from './MashupToolbar';
import { EvolveOptionsModal } from './EvolveOptionsModal';
import { LogOverlay, type LogEntry } from './LogOverlay';
import { ProfilingOverlay } from './ProfilingOverlay';
import WebGPUCheck from './WebGPUCheck';
import { shaderStore, inputStore, resultStore, evolutionStore } from '@/stores';
import { apiKey } from '@/stores/apiKeyStore';
import { getWebGPUContext, WebGPUContext } from '@/core/engine/WebGPUContext';
import { ShaderCompiler } from '@/core/engine/ShaderCompiler';
import { BufferManager } from '@/core/engine/BufferManager';
import { ParameterManager } from '@/core/engine/ParameterManager';
import { PipelineBuilder } from '@/core/engine/PipelineBuilder';
import { Executor, createExecutionContext } from '@/core/engine/Executor';
import { GPUPostProcessor } from '@/core/engine/GPUPostProcessor';
import { ResultRenderer } from '@/core/output/ResultRenderer';
import { PostProcessor } from '@/core/output/PostProcessor';
import { withGPUErrorScope } from '@/core/engine/GPUErrorHandler';
import { executeFeedbackLoop } from '@/core/engine/FeedbackLoop';
import { prepareShader } from '@/core/engine/ShaderPreparation';
import { AnimationController, type FrameProfile } from '@/core/engine/AnimationController';
import { ShaderEvolver, formatTokenCount } from '@/core/llm';
import type { TokenUsage } from '@/core/llm';
import type { ShaderDefinition } from '@/types/core';
import { getErrorMessage, calculateSupersampledDimensions } from '@/utils/helpers';
import { ShaderExporter } from '@/utils/ShaderExporter';
import { ShaderImporter } from '@/utils/ShaderImporter';

// Import example shader sources
import sineWaveSource from '../shaders/examples/sine-wave.wgsl?raw';
import colorMixerSource from '../shaders/examples/color-mixer.wgsl?raw';
import checkerboardSource from '../shaders/examples/checkerboard.wgsl?raw';
import radialGradientSource from '../shaders/examples/radial-gradient.wgsl?raw';
import perlinCloudsSource from '../shaders/examples/perlin-clouds.wgsl?raw';
import marbleSource from '../shaders/examples/marble.wgsl?raw';
import cellularPatternSource from '../shaders/examples/cellular-pattern.wgsl?raw';
import sineWaveTexturedSource from '../shaders/examples/sine-wave-textured.wgsl?raw';
import feedbackSource from '../shaders/examples/feedback.wgsl?raw';

// ============================================================================
// Evolution Configuration
// ============================================================================
const EVOLUTION_CONFIG = {
  // Normal evolution settings
  childrenCount: 6,           // Number of children to generate per evolution
  experimentsPerChild: 1,     // Number of experimental renders per child

  // Mashup settings
  mashupCount: 4,             // Number of mashup variations to generate
  mashupExperiments: 1,       // Number of experimental renders per mashup
};

export const App: Component = () => {
  const [webgpuReady, setWebgpuReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Persist temperature and model in localStorage
  const storedTemp = localStorage.getItem('evolve-temperature');
  const storedModel = localStorage.getItem('evolve-model');
  const parsedTemp = storedTemp ? parseFloat(storedTemp) : NaN;
  const [temperature, _setTemperature] = createSignal(
    Number.isFinite(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 2 ? parsedTemp : 0.9
  );
  const VALID_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];
  const DEFAULT_MODEL = 'claude-haiku-4-5';
  const [model, _setModel] = createSignal(
    storedModel && VALID_MODELS.includes(storedModel) ? storedModel : DEFAULT_MODEL
  );
  const setTemperature = (v: number) => { localStorage.setItem('evolve-temperature', String(v)); _setTemperature(v); };
  const setModel = (v: string) => { localStorage.setItem('evolve-model', v); _setModel(v); };
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [logOverlayOpen, setLogOverlayOpen] = createSignal(false);
  const [mashupInProgress, setMashupInProgress] = createSignal(false);
  const [mashupSummary, setMashupSummary] = createSignal<string | null>(null);
  const [profilingVisible, setProfilingVisible] = createSignal(false);
  const [profilingConsoleLog, setProfilingConsoleLog] = createSignal(false);
  const [frameProfiles, setFrameProfiles] = createSignal<Map<string, FrameProfile>>(new Map());
  const [lastUsage, setLastUsage] = createSignal<{ usage: TokenUsage; cost: number; model: string } | null>(null);

  // Evolve/Mashup options modal state
  const [evolveOptionsOpen, setEvolveOptionsOpen] = createSignal(false);
  const [evolveOptionsMode, setEvolveOptionsMode] = createSignal<'evolve' | 'mashup'>('evolve');
  const [pendingEvolveShaderId, setPendingEvolveShaderId] = createSignal<string | null>(null);

  const maxLogEntries = 32;
  // Add log entry to the overlay (at the end of the list)
  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => {
     const old = prev.slice(-(maxLogEntries-1));
     return [...old, { timestamp: new Date(), message, type }];
    });
  };

  // Track fullscreen animations for adaptive supersampling
  // Maps shaderId -> { display dimensions, current supersample factor }
  const fullscreenAnimations = new Map<string, { dimensions: { width: number; height: number }; supersampleFactor: number }>();

  // WebGPU components
  let context: WebGPUContext;
  let compiler: ShaderCompiler;
  let bufferManager: BufferManager;
  let parameterManager: ParameterManager;
  let pipelineBuilder: PipelineBuilder;
  let executor: Executor;
  let resultRenderer: ResultRenderer;
  let postProcessor: PostProcessor;
  let gpuPostProcessor: GPUPostProcessor;
  let shaderEvolver: ShaderEvolver;
  let animationController: AnimationController;

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
      resultRenderer = new ResultRenderer(bufferManager, context);
      postProcessor = new PostProcessor(context, bufferManager);
      gpuPostProcessor = new GPUPostProcessor(context, compiler, bufferManager);

      // Animation controller for mouse-over animation
      animationController = new AnimationController(
        context,
        pipelineBuilder,
        executor,
        gpuPostProcessor,
        (shaderId, gpuTexture) => {
          // Update result store with new frame's GPU texture
          const existingResult = resultStore.getResult(shaderId);
          resultStore.updateResult({
            shaderId,
            imageData: existingResult?.imageData,
            executionTime: existingResult?.executionTime ?? 0,
            timestamp: new Date(),
            gpuTexture,
          });
        },
        (profile) => {
          // Update profiling data
          setFrameProfiles(prev => {
            const next = new Map(prev);
            next.set(profile.shaderId, profile);
            return next;
          });
          // Console logging when enabled
          if (profilingConsoleLog()) {
            console.log(
              `[Perf] "${profile.shaderName}" ${profile.totalFrameMs.toFixed(1)}ms (exec:${profile.shaderExecMs.toFixed(1)} copy:${profile.feedbackCopyMs.toFixed(1)} post:${profile.postProcessMs.toFixed(1)}) ${profile.superWidth}x${profile.superHeight} case-${profile.executionCase} iter:${profile.iterations}`
            );
          }
        },
        (shaderId) => {
          // Adaptive supersample: restart slow fullscreen animations at lower supersample
          const fsInfo = fullscreenAnimations.get(shaderId);
          if (!fsInfo || fsInfo.supersampleFactor <= 1) return;
          const newFactor = Math.max(1, fsInfo.supersampleFactor - 1);
          const elapsed = animationController.getElapsedTime(shaderId);
          animationController.stopAnimation(shaderId);
          fsInfo.supersampleFactor = newFactor;
          console.log(`[Perf] Restarting "${shaderId}" at ${newFactor}x supersample`);
          handleAnimationStart(shaderId, fsInfo.dimensions, elapsed);
        },
      );

      // CanvasRenderer created on-demand in ShaderEvolver for GPU-only thumbnail rendering

      // Initialize ShaderEvolver reactively based on API key
      const initShaderEvolver = (key: string) => {
        if (!key) {
          shaderEvolver = undefined as any;
          console.warn('No API key set - evolution feature disabled');
          return;
        }
        console.log('API Key check:', `Found (${key.substring(0, 15)}...)`);
        shaderEvolver = new ShaderEvolver(key, compiler, parameterManager, context, bufferManager, {
          experimentsPerChild: EVOLUTION_CONFIG.experimentsPerChild,
          mashupExperiments: EVOLUTION_CONFIG.mashupExperiments,
          onProgress: (update) => {
            const activeEvolutions = Array.from(evolutionStore.activeEvolutions.entries());
            if (activeEvolutions.length > 0) {
              const [shaderId] = activeEvolutions[0];
              if (update.type === 'child') {
                evolutionStore.updateProgress(shaderId, {
                  currentChild: update.currentChild || 0,
                  currentExperiment: update.currentExperiment || 0,
                  status: 'mutating',
                });
              } else if (update.type === 'experiment') {
                evolutionStore.updateProgress(shaderId, {
                  currentExperiment: update.currentExperiment || 0,
                  status: 'mutating',
                });
              } else if (update.type === 'debug') {
                evolutionStore.updateProgress(shaderId, {
                  debugAttempt: update.debugAttempt || 0,
                  status: 'debugging',
                });
              }
            }
          },
          onUsageUpdate: (usage, cost, usageModel) => {
            setLastUsage({ usage: { ...usage }, cost, model: usageModel });
          },
          onChildCompleted: async (result, index, total) => {
            const activeEvolutions = Array.from(evolutionStore.activeEvolutions.entries());

            if (activeEvolutions.length > 0) {
              const [shaderId] = activeEvolutions[0];

              if (result.success && result.shader) {
                addLog(`✓ Child ${index + 1}/${total} compiled successfully (${result.debugAttempts || 0} debug attempts)`);
                evolutionStore.addChild(shaderId, result.shader);
                await executeShader(result.shader.id, result.shader);
              } else {
                addLog(`✗ Child ${index + 1}/${total} failed: ${result.error}`, 'error');
                evolutionStore.updateProgress(shaderId, {
                  lastError: result.error,
                });
              }
            } else if (mashupInProgress()) {
              if (result.success && result.shader) {
                addLog(`✓ Mashup ${index + 1}/${total} compiled successfully`);
                evolutionStore.addMashupResult(result.shader);
                await executeShader(result.shader.id, result.shader);
              } else {
                addLog(`✗ Mashup ${index + 1}/${total} failed: ${result.error}`, 'error');
              }
            }
          }
        });
        console.log('ShaderEvolver initialized successfully');
      };

      // Initialize with current key (may be empty)
      initShaderEvolver(apiKey());

      // Re-initialize when API key changes
      createEffect(on(apiKey, (key) => {
        if (context) initShaderEvolver(key);
      }, { defer: true }));

      setWebgpuReady(true);

      // Load promoted shaders from localStorage
      const promotedCount = shaderStore.loadPromotedShaders();
      console.log(`Loaded ${promotedCount} promoted shaders from localStorage`);

      // Re-parse parameters for all promoted shaders to fix any inconsistencies
      for (const shader of shaderStore.shaders.values()) {
        if (shaderStore.isPromoted(shader.id)) {
          const reparsedParams = parameterManager.parseParameters(shader.source);
          const reparsedIterations = parameterManager.parseIterations(shader.source);

          // Check if parameters changed
          if (reparsedParams.length !== shader.parameters.length) {
            console.log(`[Storage Fix] Shader "${shader.name}" had ${shader.parameters.length} params, re-parsed to ${reparsedParams.length}`);
            shaderStore.updateShader(shader.id, shader.source, reparsedParams);
          }

          // Check if iterations changed
          if (reparsedIterations !== shader.iterations) {
            console.log(`[Storage Fix] Shader "${shader.name}" had ${shader.iterations} iterations, re-parsed to ${reparsedIterations}`);
            shaderStore.updateIterationValue(shader.id, reparsedIterations);
          }
        }
      }

      // Keyboard shortcuts
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'r' || e.key === '0') {
          animationController.resetAll();
        } else if (e.key === 'p') {
          const newVisible = !profilingVisible();
          setProfilingVisible(newVisible);
          animationController.setProfilingEnabled(newVisible);
          if (!newVisible) {
            setFrameProfiles(new Map());
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      onCleanup(() => window.removeEventListener('keydown', handleKeyDown));

      // Load example shaders
      loadExampleShaders();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to initialize WebGPU'));
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
        name: 'Checkerboard',
        source: checkerboardSource,
        description: 'Rotatable checkerboard pattern',
      },
      {
        name: 'Radial Gradient',
        source: radialGradientSource,
        description: 'HSV-based radial gradient',
      },
      {
        name: 'Perlin Clouds',
        source: perlinCloudsSource,
        description: 'Cloud-like patterns using Perlin noise and FBM',
      },
      {
        name: 'Marble Texture',
        source: marbleSource,
        description: 'Marble-like patterns with turbulence and domain warping',
      },
      {
        name: 'Cellular Pattern',
        source: cellularPatternSource,
        description: 'Voronoi-like cellular noise for organic patterns',
      },
      {
        name: 'Color Mixer',
        source: colorMixerSource,
        description: 'RGB gradient generator with multiple mix modes',
      },
      {
        name: 'Polygon Shapes',
        source: sineWaveTexturedSource,
        description: 'Layered polygon SDFs with smooth blending and glow',
      },
      {
        name: 'Feedback Loop',
        source: feedbackSource,
        description: 'Iterative diffusion with decay and injection — accumulates across animation frames',
      },
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

  /**
   * Execute a prepared shader, handling iterations and prevFrame bindings.
   * Encapsulates the three execution modes: feedback loop, single with black prevFrame, and simple.
   */
  const executePreparedShader = async (
    prep: Awaited<ReturnType<typeof prepareShader>>,
    dimensions: { width: number; height: number },
    labelSuffix: string,
  ) => {
    const device = context.getDevice();
    const { outputTexture, dimensionsBuffer, paramBuffer, layout, pipeline, workgroups, iterations, hasIterations, hasInputTexture } = prep;

    if (hasIterations) {
      await executeFeedbackLoop(
        device, dimensions, iterations, outputTexture, labelSuffix,
        async (ctx) => {
          const bindGroup = pipelineBuilder.createStandardBindGroup(
            layout, outputTexture, dimensionsBuffer, paramBuffer,
            ctx.prevTexture, ctx.prevSampler,
          );
          await executor.execute(createExecutionContext(pipeline, bindGroup, workgroups, outputTexture));
        },
      );
    } else if (hasInputTexture) {
      // Shader declares prevFrame but no iterations — provide a black texture
      const blackTexture = device.createTexture({
        size: [dimensions.width, dimensions.height],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        label: `black-prevframe-${labelSuffix}`,
      });
      const blackSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      try {
        const bindGroup = pipelineBuilder.createStandardBindGroup(
          layout, outputTexture, dimensionsBuffer, paramBuffer,
          blackTexture, blackSampler,
        );
        await executor.execute(createExecutionContext(pipeline, bindGroup, workgroups, outputTexture));
      } finally {
        blackTexture.destroy();
      }
    } else {
      const bindGroup = pipelineBuilder.createStandardBindGroup(
        layout, outputTexture, dimensionsBuffer, paramBuffer,
      );
      await executor.execute(createExecutionContext(pipeline, bindGroup, workgroups, outputTexture));
    }
  };

  const executeShader = async (shaderId: string, shaderOverride?: ShaderDefinition) => {
    try {
      // Use provided shader or look up from store
      const shader = shaderOverride || shaderStore.getShader(shaderId);
      if (!shader) return;

      const dimensions = inputStore.outputDimensions;

      // Supersample at 3x for antialiasing
      const supersampleFactor = 3;
      const superDimensions = calculateSupersampledDimensions(dimensions, supersampleFactor);

      // Get global parameters for zoom/pan
      const globalParams = shaderStore.getGlobalParameters(shaderId);

      // Prepare shader: compile and create all necessary resources (zoom/pan now in dimensions buffer)
      const paramValues = shaderOverride
        ? new Map(shader.parameters.map(p => [p.name, p.default]))
        : undefined; // undefined means use store values

      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        context,
        (id) => shaderStore.getIterationValue(id),
        (id) => shaderStore.getParameterValues(id),
        {
          shader,
          shaderId,
          dimensions: superDimensions,
          zoom: globalParams.zoom,
          panX: globalParams.panX,
          panY: globalParams.panY,
          labelSuffix: '',
          parameterValues: paramValues,
          measureCompileTime: true,
        }
      );

      const { outputTexture, compileTime } = prep;
      const startExec = performance.now();

      // Execute shader with GPU error scope handling
      const device = context.getDevice();
      await withGPUErrorScope(device, 'shader execution', async () => {
        await executePreparedShader(prep, superDimensions, '');
      });

      const execTime = performance.now() - startExec;

      // GPU-only path: zero CPU readback
      const postProcessStart = performance.now();
      const processed = await withGPUErrorScope(device, 'gpu-post-processing', async () => {
        return await gpuPostProcessor.applyGammaContrast(
          shaderId,
          outputTexture,
          superDimensions,
          globalParams.gamma,
          globalParams.contrast
        );
      });
      const postProcessTime = performance.now() - postProcessStart;

      const gpuTexture = processed.displayTexture;

      const totalTime = (compileTime ?? 0) + execTime + postProcessTime;

      // Log execution time
      addLog(
        `Rendered "${shader.name}": compile ${(compileTime ?? 0).toFixed(1)}ms + exec ${execTime.toFixed(1)}ms + post ${postProcessTime.toFixed(1)}ms = ${totalTime.toFixed(1)}ms (${superDimensions.width}x${superDimensions.height} → ${dimensions.width}x${dimensions.height})`
      );

      // Log slow renders to console for debugging
      if (totalTime > 500) {
        console.warn(`[RENDER] Slow render of "${shader.name}" (${totalTime.toFixed(1)}ms): compile=${(compileTime ?? 0).toFixed(1)}ms, exec=${execTime.toFixed(1)}ms, post=${postProcessTime.toFixed(1)}ms`);
      }

      // Update result store
      resultStore.updateResult({
        shaderId,
        executionTime: totalTime,
        timestamp: new Date(),
        gpuTexture,
      });

      resultStore.clearError(shaderId);
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      resultStore.setError(shaderId, errorMessage);
      console.error(`Shader ${shaderId} execution failed:`, err);

      // If this is a GPU validation error, log the shader source for debugging
      if (errorMessage.includes('GPU validation error') || errorMessage.includes('binding') || errorMessage.includes('Binding')) {
        const shader = shaderOverride || shaderStore.getShader(shaderId);
        if (shader) {
          console.error(`Failed shader "${shader.name}" (${shaderId})`);
          console.error(`Shader source:`, shader.source);
          console.error(`Shader parameters:`, shader.parameters);
          console.error(`Shader iterations:`, shader.iterations);
        }
      }
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
    if (animationController.isAnimating(shaderId)) {
      // Update param buffer in-place — avoids race with animation loop
      const shader = shaderStore.getShader(shaderId);
      if (shader) {
        const paramValues = shaderStore.getParameterValues(shaderId);
        const paramData = parameterManager.getParameterValues(shader.parameters, paramValues);
        animationController.updateParameterBuffer(shaderId, paramData);
      }
    } else {
      executeShader(shaderId);
    }
  };

  const handleIterationChange = (shaderId: string, value: number) => {
    shaderStore.updateIterationValue(shaderId, value);
    // Re-execute shader with new iteration count
    executeShader(shaderId);
  };

  const handleGlobalParameterChange = (shaderId: string, paramName: keyof import('@/stores/shaderStore').GlobalParameters, value: number) => {
    shaderStore.updateGlobalParameter(shaderId, paramName, value);
    if (animationController.isAnimating(shaderId)) {
      const gp = shaderStore.getGlobalParameters(shaderId);
      animationController.updateGlobalParams(shaderId, gp);
    } else {
      executeShader(shaderId);
    }
  };

  const handleGlobalParametersReset = (shaderId: string) => {
    shaderStore.resetGlobalParameters(shaderId);
    if (animationController.isAnimating(shaderId)) {
      const gp = shaderStore.getGlobalParameters(shaderId);
      animationController.updateGlobalParams(shaderId, gp);
    } else {
      executeShader(shaderId);
    }
  };

  const handleAnimationStart = async (shaderId: string, overrideDimensions?: { width: number; height: number }, timeOffset?: number) => {
    if (animationController.isAnimating(shaderId)) return;

    // Find shader in main store, evolution children, or mashup results
    let shader = shaderStore.getShader(shaderId);
    if (!shader) {
      // Search evolution children across all parents
      for (const children of evolutionStore.children.values()) {
        const found = children.find(c => c.id === shaderId);
        if (found) { shader = found; break; }
      }
    }
    if (!shader) {
      shader = evolutionStore.getMashupResults().find(m => m.id === shaderId);
    }
    if (!shader) return;

    try {
      const dimensions = overrideDimensions || inputStore.outputDimensions;
      const isFullscreen = !!overrideDimensions;

      // Use tracked supersample factor for fullscreen (may have been reduced), otherwise default 3x
      let supersampleFactor = 3;
      if (isFullscreen) {
        const existing = fullscreenAnimations.get(shaderId);
        if (existing) {
          supersampleFactor = existing.supersampleFactor;
        } else {
          fullscreenAnimations.set(shaderId, { dimensions, supersampleFactor });
        }
      }

      const superDimensions = calculateSupersampledDimensions(dimensions, supersampleFactor);
      const globalParams = shaderStore.getGlobalParameters(shaderId);

      // Prepare shader (compile + create resources) — cached by pipeline builder
      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        context,
        (id) => shaderStore.getIterationValue(id),
        (id) => shaderStore.getParameterValues(id),
        {
          shader,
          shaderId,
          dimensions: superDimensions,
          zoom: globalParams.zoom,
          panX: globalParams.panX,
          panY: globalParams.panY,
          labelSuffix: 'anim',
          measureCompileTime: false,
        }
      );

      animationController.startAnimation(
        shaderId,
        prep,
        superDimensions,
        dimensions,
        { gamma: globalParams.gamma, contrast: globalParams.contrast },
        timeOffset ?? 0,
        shader.name,
      );
    } catch (err) {
      console.error(`Failed to start animation for ${shaderId}:`, err);
    }
  };

  const handleAnimationStop = (shaderId: string): number => {
    const elapsed = animationController.getElapsedTime(shaderId);
    animationController.stopAnimation(shaderId);
    fullscreenAnimations.delete(shaderId);
    return elapsed;
  };

  const handleEvolve = (shaderId: string) => {
    if (!shaderEvolver) {
      alert('Please set your Anthropic API key using the API Key button in the toolbar');
      return;
    }
    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

    setPendingEvolveShaderId(shaderId);
    setEvolveOptionsMode('evolve');
    setEvolveOptionsOpen(true);
  };

  const runEvolve = async (shaderId: string, childrenCount: number, instructions: string, overrideTemp: number, overrideModel: string) => {
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

    const currentTemp = overrideTemp;
    const currentModel = overrideModel;
    evolutionStore.startEvolution(shaderId, shader.name, childrenCount, currentTemp, EVOLUTION_CONFIG.experimentsPerChild);

    const instrNote = instructions ? `, instructions: "${instructions.substring(0, 50)}${instructions.length > 50 ? '...' : ''}"` : '';
    addLog(`Starting evolution of "${shader.name}" (model: ${currentModel}, temp: ${currentTemp.toFixed(2)}, children: ${childrenCount}${instrNote})`);
    setLastUsage(null);
    const evolveStart = performance.now();

    try {
      addLog(`Generating ${childrenCount} shader variations...`);

      const results = await shaderEvolver.evolveShaderBatch(
        shaderWithBakedParams, childrenCount, currentTemp, currentModel,
        instructions || undefined
      );

      const usage = lastUsage();
      const elapsed = ((performance.now() - evolveStart) / 1000).toFixed(1);
      const costStr = usage ? ` — $${usage.cost.toFixed(4)} (${formatTokenCount(usage.usage.inputTokens)} in + ${formatTokenCount(usage.usage.outputTokens)} out, ${usage.usage.apiCalls} API calls)` : '';
      addLog(`Evolution complete: ${results.filter(r => r.success).length}/${childrenCount} succeeded${costStr} in ${elapsed}s`, 'success');
    } catch (error) {
      const errorMsg = getErrorMessage(error, 'Unknown batch evolution error');
      addLog(`Evolution failed: ${errorMsg}`, 'error');
      console.error('Batch evolution error:', error);
      evolutionStore.updateProgress(shaderId, {
        lastError: errorMsg,
      });
    }

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
      gpuPostProcessor.clearShaderTextures(shaderId); // Clean up pooled textures
      addLog(`Deleted shader "${shader.name}"`);
    }
  };

  const handleShaderCompile = async (source: string): Promise<{ success: boolean; errors?: Array<{ message: string; line?: number; column?: number }> }> => {
    try {
      // Try to compile the source (without saving)
      const compileResult = await compiler.compile(source, 'live-check', false);

      // Get the line offset (number of lines before user code starts)
      const lineOffset = compiler.getUserCodeLineOffset();

      if (!compileResult.success) {
        // Adjust line numbers to be relative to user code
        const adjustedErrors = compileResult.errors
          .map(error => {
            if (error.line !== undefined) {
              const adjustedLine = error.line - lineOffset;
              // Only include errors in user code (not in prepended libraries)
              if (adjustedLine > 0) {
                return { ...error, line: adjustedLine };
              }
              // Error is in library code, show generic message
              return { message: `${error.message} (in library code)`, line: undefined, column: undefined };
            }
            return error;
          })
          .filter(error => error !== null);

        return { success: false, errors: adjustedErrors };
      }

      // Also validate pipeline creation
      const hasParams = source.includes('struct Params');
      const hasInputTexture = source.includes('prevFrame');
      const pipelineErrors = await compiler.validatePipeline(compileResult.module!, hasParams, hasInputTexture);

      if (pipelineErrors.length > 0) {
        // Convert pipeline errors to the expected format (no line numbers for pipeline errors)
        const errors = pipelineErrors.map(msg => ({ message: msg }));
        return { success: false, errors };
      }

      return { success: true, errors: [] };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      return { success: false, errors: [{ message: errorMsg }] };
    }
  };

  const handleShaderEdit = async (shaderId: string, newSource: string): Promise<{ success: boolean; error?: string }> => {
    const shader = shaderStore.getShader(shaderId);
    if (!shader) {
      return { success: false, error: 'Shader not found' };
    }

    addLog(`Compiling edited shader "${shader.name}"...`);

    try {
      // Try to compile the new source
      const compileResult = await compiler.compile(newSource, `edit-${shaderId}`, false);

      if (!compileResult.success || !compileResult.module) {
        const errorMsg = ShaderCompiler.formatErrors(compileResult.errors);
        addLog(`Compilation failed: ${errorMsg}`, 'error');
        return { success: false, error: `Compilation error:\n${errorMsg}` };
      }

      // Validate by creating a GPU pipeline
      const hasParams = newSource.includes('struct Params');
      const hasInputTexture = newSource.includes('prevFrame');
      const pipelineErrors = await compiler.validatePipeline(compileResult.module, hasParams, hasInputTexture);

      if (pipelineErrors.length > 0) {
        const errorMsg = pipelineErrors.join('\n');
        addLog(`GPU validation failed: ${errorMsg}`, 'error');
        return { success: false, error: `GPU validation error:\n${errorMsg}` };
      }

      // Parse new parameters from the edited source
      const newParameters = parameterManager.parseParameters(newSource);
      const newIterations = parameterManager.parseIterations(newSource);

      console.log('[ShaderEdit] Parsed parameters:', newParameters);
      console.log('[ShaderEdit] Parameter count:', newParameters.length);

      // Update shader in store (this handles source, parameters, and parameter values)
      shaderStore.updateShader(shaderId, newSource, newParameters);

      // Verify the update worked
      const updatedShader = shaderStore.getShader(shaderId);
      console.log('[ShaderEdit] Updated shader from store:', updatedShader?.parameters.length, 'parameters');

      // Also update iterations if they changed
      if (newIterations !== shader.iterations) {
        shaderStore.updateIterationValue(shaderId, newIterations);
      }

      // Clear caches to ensure new shader code is used
      // (without this, cached pipelines and shader modules will use old code)
      compiler.clearCache();
      pipelineBuilder.clearCache();
      bufferManager.destroyPool(); // Clear buffer pool to avoid reusing old parameter buffers

      // Re-execute the shader with the new source
      await executeShader(shaderId);

      addLog(`Successfully updated shader "${shader.name}"`, 'success');
      return { success: true };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      addLog(`Failed to update shader: ${errorMsg}`, 'error');
      return { success: false, error: errorMsg };
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
      const superDimensions = calculateSupersampledDimensions(hiResDimensions, supersampleFactor);

      // Get global parameters
      const globalParams = shaderStore.getGlobalParameters(shaderId);

      // Get device for error scopes
      const device = context.getDevice();

      // Prepare shader: compile and create all necessary resources (zoom/pan now in dimensions buffer)
      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        context,
        (id) => shaderStore.getIterationValue(id),
        (id) => shaderStore.getParameterValues(id),
        {
          shader,
          shaderId,
          dimensions: superDimensions,
          zoom: globalParams.zoom,
          panX: globalParams.panX,
          panY: globalParams.panY,
          labelSuffix: 'hires',
          measureCompileTime: false,
        }
      );

      const { outputTexture } = prep;

      addLog(`Rendering at ${superDimensions.width}x${superDimensions.height}...`);

      // Execute shader (with iterations if needed) with GPU error scope handling
      await withGPUErrorScope(device, 'shader execution', async () => {
        await executePreparedShader(prep, superDimensions, 'hires');
        // CRITICAL: Wait for shader execution to complete
        await context.getDevice().queue.onSubmittedWorkDone();
      });

      // Copy HDR texture to buffer for post-processing (temporary bridge for MVP)
      // TODO: Update post-processor to work directly with textures
      const outputSize = superDimensions.width * superDimensions.height * 4 * 4; // vec4<f32> = 16 bytes per pixel
      const outputBuffer = bufferManager.createBuffer({
        size: outputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        label: 'texture-copy-buffer-hires',
      }, false);

      // Copy texture to buffer
      const copyEncoder = device.createCommandEncoder({ label: 'texture-to-buffer-copy-hires' });
      copyEncoder.copyTextureToBuffer(
        { texture: outputTexture },
        { buffer: outputBuffer, bytesPerRow: superDimensions.width * 16, offset: 0 }, // rgba32float = 16 bytes/pixel
        { width: superDimensions.width, height: superDimensions.height }
      );
      device.queue.submit([copyEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      // Apply gamma/contrast post-processing
      const processedBuffer = await withGPUErrorScope(device, 'post-processing', async () => {
        return await postProcessor.applyGammaContrast(
          outputBuffer,
          superDimensions,
          globalParams.gamma,
          globalParams.contrast
        );
      });

      // Downsample to final resolution
      const downsampledBuffer = await withGPUErrorScope(device, 'downsampling', async () => {
        return resultRenderer.downsample(
          processedBuffer,
          superDimensions,
          hiResDimensions,
          supersampleFactor
        );
      });

      // Wait for all GPU work to complete before downloading
      await context.getDevice().queue.onSubmittedWorkDone();

      // Download as PNG
      const filename = `${shader.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${hiResDimensions.width}x${hiResDimensions.height}.png`;
      await resultRenderer.downloadImage(downsampledBuffer, hiResDimensions, filename, 'image/png');

      addLog(`Downloaded "${filename}"`, 'success');
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      addLog(`Download failed: ${errorMessage}`, 'error');
      console.error('Download error:', err);
    }
  };

  const handleExportShader = async (shaderId: string) => {
    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

    addLog(`Exporting shader "${shader.name}"...`);

    try {
      // Get the current result image data URL
      const result = resultStore.getResult(shaderId);
      let imageDataUrl: string | undefined;

      if (result?.gpuTexture) {
        // Use GPU texture to create data URL
        const dimensions = { width: 512, height: 512 };
        const globalParams = shaderStore.getGlobalParameters(shaderId);
        const device = context.getDevice();

        // Render at 512x512 for preview
        const prep = await prepareShader(
          compiler,
          bufferManager,
          parameterManager,
          pipelineBuilder,
          executor,
          context,
          (id) => shaderStore.getIterationValue(id),
          (id) => shaderStore.getParameterValues(id),
          {
            shader,
            shaderId,
            dimensions,
            zoom: globalParams.zoom,
            panX: globalParams.panX,
            panY: globalParams.panY,
            labelSuffix: 'export',
            measureCompileTime: false,
          }
        );

        const { outputTexture } = prep;

        await withGPUErrorScope(device, 'export render', async () => {
          await executePreparedShader(prep, dimensions, 'export');
        });

        // Copy to buffer and convert to ImageData
        const outputSize = dimensions.width * dimensions.height * 4 * 4;
        const outputBuffer = bufferManager.createBuffer({
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          label: 'export-buffer',
        }, false);

        const copyEncoder = device.createCommandEncoder({ label: 'export-copy' });
        copyEncoder.copyTextureToBuffer(
          { texture: outputTexture },
          { buffer: outputBuffer, bytesPerRow: dimensions.width * 16, offset: 0 },
          { width: dimensions.width, height: dimensions.height }
        );
        device.queue.submit([copyEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        const processedBuffer = await withGPUErrorScope(device, 'export-post-processing', async () => {
          return await postProcessor.applyGammaContrast(
            outputBuffer,
            dimensions,
            globalParams.gamma,
            globalParams.contrast
          );
        });

        imageDataUrl = await resultRenderer.bufferToDataURL(processedBuffer, dimensions, 'image/png');
      }

      // Export the shader
      await ShaderExporter.exportShader(shader, imageDataUrl);
      addLog(`Exported "${shader.name}"`, 'success');
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      addLog(`Export failed: ${errorMessage}`, 'error');
      console.error('Export error:', err);
    }
  };

  const handleExportAllShaders = async () => {
    const shaders = shaderStore.getActiveShaders();
    if (shaders.length === 0) {
      addLog('No shaders to export', 'error');
      return;
    }

    addLog(`Exporting ${shaders.length} shaders...`);

    try {
      // Create map of shader IDs to image data URLs
      const imageDataUrls = new Map<string, string>();

      for (const shader of shaders) {
        const result = resultStore.getResult(shader.id);
        if (result?.gpuTexture) {
          // Use GPU texture to create data URL (512x512 preview)
          const dimensions = { width: 512, height: 512 };
          const globalParams = shaderStore.getGlobalParameters(shader.id);
          const device = context.getDevice();

          const prep = await prepareShader(
            compiler,
            bufferManager,
            parameterManager,
            pipelineBuilder,
            executor,
            context,
            (id) => shaderStore.getIterationValue(id),
            (id) => shaderStore.getParameterValues(id),
            {
              shader,
              shaderId: shader.id,
              dimensions,
              zoom: globalParams.zoom,
              panX: globalParams.panX,
              panY: globalParams.panY,
              labelSuffix: 'export-all',
              measureCompileTime: false,
            }
          );

          const { outputTexture } = prep;

          await withGPUErrorScope(device, 'export-all render', async () => {
            await executePreparedShader(prep, dimensions, 'export-all');
          });

          const outputSize = dimensions.width * dimensions.height * 4 * 4;
          const outputBuffer = bufferManager.createBuffer({
            size: outputSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            label: 'export-all-buffer',
          }, false);

          const copyEncoder = device.createCommandEncoder({ label: 'export-all-copy' });
          copyEncoder.copyTextureToBuffer(
            { texture: outputTexture },
            { buffer: outputBuffer, bytesPerRow: dimensions.width * 16, offset: 0 },
            { width: dimensions.width, height: dimensions.height }
          );
          device.queue.submit([copyEncoder.finish()]);
          await device.queue.onSubmittedWorkDone();

          const processedBuffer = await withGPUErrorScope(device, 'export-all-post-processing', async () => {
            return await postProcessor.applyGammaContrast(
              outputBuffer,
              dimensions,
              globalParams.gamma,
              globalParams.contrast
            );
          });

          const dataUrl = await resultRenderer.bufferToDataURL(processedBuffer, dimensions, 'image/png');
          imageDataUrls.set(shader.id, dataUrl);
        }
      }

      // Export all shaders
      await ShaderExporter.exportAllShaders(shaders, imageDataUrls);
      addLog(`Exported ${shaders.length} shaders`, 'success');
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      addLog(`Export all failed: ${errorMessage}`, 'error');
      console.error('Export all error:', err);
    }
  };

  const handleImportShaders = async () => {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      addLog(`Importing from "${file.name}"...`);

      try {
        const result = await ShaderImporter.importFromZip(file);

        if (result.errors.length > 0) {
          for (const error of result.errors) {
            addLog(error, 'error');
          }
        }

        if (result.success) {
          // Add imported shaders as promoted shaders
          for (const shader of result.shaders) {
            // Parse parameters from source if not already present
            if (shader.parameters.length === 0) {
              shader.parameters = parameterManager.parseParameters(shader.source);
            }
            if (!shader.iterations || shader.iterations === 1) {
              shader.iterations = parameterManager.parseIterations(shader.source);
            }

            shaderStore.addPromotedShader(shader);
            await executeShader(shader.id);
          }

          addLog(`Imported ${result.shaders.length} shader(s)`, 'success');
        } else {
          addLog('Import failed', 'error');
        }
      } catch (err) {
        const errorMessage = getErrorMessage(err);
        addLog(`Import failed: ${errorMessage}`, 'error');
        console.error('Import error:', err);
      }
    };

    input.click();
  };

  const handleMashup = () => {
    if (!shaderEvolver) {
      alert('Please set your Anthropic API key using the API Key button in the toolbar');
      return;
    }

    const selectedShaders = shaderStore.getMashupSelected();
    if (selectedShaders.length < 2) {
      alert('Please select at least 2 shaders for mashup');
      return;
    }

    setEvolveOptionsMode('mashup');
    setEvolveOptionsOpen(true);
  };

  const runMashup = async (mashupCount: number, instructions: string, overrideTemp: number, overrideModel: string) => {
    const selectedShaders = shaderStore.getMashupSelected();
    if (selectedShaders.length < 2) return;

    const currentTemp = overrideTemp;
    const currentModel = overrideModel;
    const parentNames = selectedShaders.map(s => s.name);

    setMashupInProgress(true);
    setMashupSummary(null);
    const instrNote = instructions ? `, instructions: "${instructions.substring(0, 50)}${instructions.length > 50 ? '...' : ''}"` : '';
    addLog(`Starting mashup of ${selectedShaders.length} shaders: ${parentNames.join(', ')} (model: ${currentModel}, temp: ${currentTemp.toFixed(2)}, variants: ${mashupCount}${instrNote})`);
    setLastUsage(null);
    const mashupStart = performance.now();

    try {
      evolutionStore.clearMashupResults();

      const results = await shaderEvolver.evolveMashup(
        selectedShaders, mashupCount, currentTemp, currentModel,
        instructions || undefined
      );

      evolutionStore.setMashupResults(
        evolutionStore.getMashupResults(),
        parentNames
      );

      const usage = lastUsage();
      const elapsed = ((performance.now() - mashupStart) / 1000).toFixed(1);
      const succeeded = results.filter(r => r.success).length;
      const costStr = usage ? ` — $${usage.cost.toFixed(4)} (${formatTokenCount(usage.usage.inputTokens)} in + ${formatTokenCount(usage.usage.outputTokens)} out, ${usage.usage.apiCalls} API calls)` : '';
      const summaryStr = `${succeeded}/${mashupCount} succeeded${costStr} in ${elapsed}s`;
      addLog(`Mashup complete: ${summaryStr}`, 'success');
      setMashupSummary(summaryStr);

      shaderStore.clearMashupSelection();
    } catch (error) {
      const errorMsg = getErrorMessage(error, 'Unknown mashup error');
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
    setMashupSummary(null);
  };

  const handleEvolveOptionsConfirm = (opts: { count: number; instructions: string; temperature: number; model: string }) => {
    setEvolveOptionsOpen(false);
    if (evolveOptionsMode() === 'evolve') {
      const shaderId = pendingEvolveShaderId();
      if (shaderId) {
        setPendingEvolveShaderId(null);
        runEvolve(shaderId, opts.count, opts.instructions, opts.temperature, opts.model);
      }
    } else {
      runMashup(opts.count, opts.instructions, opts.temperature, opts.model);
    }
  };

  const handleEvolveOptionsCancel = () => {
    setEvolveOptionsOpen(false);
    setPendingEvolveShaderId(null);
  };

  /**
   * Render a preview of a shader at a specific size
   */
  const renderShaderPreview = async (shader: ShaderDefinition, size: number): Promise<ImageData | null> => {
    try {
      const dimensions = { width: size, height: size };

      // Use shader defaults for parameters
      const paramValues = new Map(shader.parameters.map(p => [p.name, p.default]));

      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        context,
        () => shader.iterations || 1,
        () => paramValues,
        {
          shader,
          shaderId: shader.id,
          dimensions,
          zoom: 1.0,  // Default zoom
          panX: 0.0,  // Default pan X
          panY: 0.0,  // Default pan Y
          labelSuffix: '-preview',
          parameterValues: paramValues,
          measureCompileTime: false,
        }
      );

      const { outputTexture } = prep;

      // Execute shader
      const device = context.getDevice();
      await withGPUErrorScope(device, 'preview render', async () => {
        await executePreparedShader(prep, dimensions, 'preview');
      });

      // Copy HDR texture to buffer for result rendering
      const outputSize = dimensions.width * dimensions.height * 4 * 4; // vec4<f32> = 16 bytes per pixel
      const outputBuffer = bufferManager.createBuffer({
        size: outputSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        label: 'texture-copy-buffer-preview',
      }, false);

      // Copy texture to buffer
      const copyEncoder = device.createCommandEncoder({ label: 'texture-to-buffer-copy-preview' });
      copyEncoder.copyTextureToBuffer(
        { texture: outputTexture },
        { buffer: outputBuffer, bytesPerRow: dimensions.width * 16, offset: 0 }, // rgba32float = 16 bytes/pixel
        { width: dimensions.width, height: dimensions.height }
      );
      device.queue.submit([copyEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      // Read result
      const imageData = await resultRenderer.bufferToImageData(outputBuffer, dimensions);
      return imageData;
    } catch (error) {
      console.error('Preview render failed:', error);
      return null;
    }
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
        <Toolbar
          temperature={temperature()}
          model={model()}
          onTemperatureChange={setTemperature}
          onModelChange={setModel}
          onImportShaders={handleImportShaders}
          onExportAllShaders={handleExportAllShaders}
        />

        <main class="app-main">

          {/* Shared props for both grids */}
          {(() => {
            const gridProps = {
              onParameterChange: handleParameterChange,
              onIterationChange: handleIterationChange,
              onGlobalParameterChange: handleGlobalParameterChange,
              onGlobalParametersReset: handleGlobalParametersReset,
              onEvolve: handleEvolve,
              onCancelEvolution: handleCancelEvolution,
              onPromoteChild: handlePromoteChild,
              onMashupToggle: handleMashupToggle,
              onDeleteShader: handleDeleteShader,
              onDownloadShader: handleDownloadShader,
              onExportShader: handleExportShader,
              onRenderPreview: renderShaderPreview,
              onShaderEdit: handleShaderEdit,
              onShaderCompile: handleShaderCompile,
              onAnimationStart: handleAnimationStart,
              onAnimationStop: handleAnimationStop,
            } as const;

            const allShaders = shaderStore.getActiveShaders();
            const examples = allShaders.filter(s => !shaderStore.isPromoted(s.id));
            const evolved = allShaders.filter(s => shaderStore.isPromoted(s.id));

            return (
              <>
                <Show when={evolved.length > 0}>
                  <h2 class="section-header">Evolved</h2>
                  <ShaderGrid shaders={evolved} {...gridProps} />
                  <hr class="section-divider" />
                </Show>

                <h2 class="section-header">Samples</h2>
                <ShaderGrid shaders={examples} {...gridProps} />
              </>
            );
          })()}

          <Show when={resultStore.isProcessing}>
            <div class="processing-indicator">Processing...</div>
          </Show>
        </main>
      </Show>

      <EvolveOptionsModal
        open={evolveOptionsOpen()}
        mode={evolveOptionsMode()}
        defaultCount={evolveOptionsMode() === 'evolve' ? EVOLUTION_CONFIG.childrenCount : EVOLUTION_CONFIG.mashupCount}
        temperature={temperature()}
        model={model()}
        onConfirm={handleEvolveOptionsConfirm}
        onCancel={handleEvolveOptionsCancel}
      />

      <MashupToolbar
        onMashup={handleMashup}
        onClear={handleClearMashupSelection}
        isLoading={mashupInProgress()}
        mashupCount={EVOLUTION_CONFIG.mashupCount}
        mashupResults={evolutionStore.getMashupResults()}
        mashupParentNames={evolutionStore.getMashupParentNames()}
        mashupSummary={mashupSummary()}
        onPromoteMashup={handlePromoteChild}
        onClearResults={handleClearMashupResults}
        onRenderPreview={renderShaderPreview}
        onAnimationStart={handleAnimationStart}
        onAnimationStop={handleAnimationStop}
      />

      <ProfilingOverlay
        profiles={frameProfiles()}
        visible={profilingVisible()}
        onClose={() => {
          setProfilingVisible(false);
          animationController.setProfilingEnabled(false);
          setFrameProfiles(new Map());
        }}
        consoleLog={profilingConsoleLog()}
        onConsoleLogToggle={() => setProfilingConsoleLog(!profilingConsoleLog())}
      />

      <LogOverlay
        logs={logs()}
        isOpen={logOverlayOpen()}
        onToggle={() => setLogOverlayOpen(!logOverlayOpen())}
      />
    </div>
  );
};
