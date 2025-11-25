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
import { withGPUErrorScope } from '@/core/engine/GPUErrorHandler';
import { executeFeedbackLoop } from '@/core/engine/FeedbackLoop';
import { prepareShader } from '@/core/engine/ShaderPreparation';
import { ShaderEvolver } from '@/core/llm';
import type { ShaderDefinition } from '@/types/core';
import { getErrorMessage, calculateSupersampledDimensions } from '@/utils/helpers';

// Import example shader sources
import sineWaveSource from '../shaders/examples/sine-wave.wgsl?raw';
import colorMixerSource from '../shaders/examples/color-mixer.wgsl?raw';
import checkerboardSource from '../shaders/examples/checkerboard.wgsl?raw';
import radialGradientSource from '../shaders/examples/radial-gradient.wgsl?raw';
// Feedback disabled for now - complicates evolution and slows down rendering
// import feedbackSource from '../shaders/examples/feedback.wgsl?raw';

// ============================================================================
// Evolution Configuration
// ============================================================================
const EVOLUTION_CONFIG = {
  // Normal evolution settings
  childrenCount: 3,           // Number of children to generate per evolution
  experimentsPerChild: 2,     // Number of experimental renders per child

  // Mashup settings
  mashupCount: 4,             // Number of mashup variations to generate
  mashupExperiments: 1,       // Number of experimental renders per mashup
};

export const App: Component = () => {
  const [webgpuReady, setWebgpuReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [temperature, setTemperature] = createSignal(0.9); // Default evolution temperature
  const [model, setModel] = createSignal('claude-haiku-4-5'); // Default model
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
        shaderEvolver = new ShaderEvolver(apiKey, compiler, parameterManager, context, bufferManager, {
          experimentsPerChild: EVOLUTION_CONFIG.experimentsPerChild,
          mashupExperiments: EVOLUTION_CONFIG.mashupExperiments,
          onProgress: (update) => {
            // Handle progress updates from shader evolver
            const activeEvolutions = Array.from(evolutionStore.activeEvolutions.entries());
            if (activeEvolutions.length > 0) {
              const [shaderId] = activeEvolutions[0]; // Get the active evolution
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
          }
        });
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
      const superDimensions = calculateSupersampledDimensions(dimensions, supersampleFactor);

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

      // Prepare shader: compile and create all necessary resources
      const paramValues = shaderOverride
        ? new Map(shader.parameters.map(p => [p.name, p.default]))
        : undefined; // undefined means use store values

      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        (id) => shaderStore.getIterationValue(id),
        (id) => shaderStore.getParameterValues(id),
        {
          shader,
          shaderId,
          dimensions: superDimensions,
          labelSuffix: '',
          parameterValues: paramValues,
          measureCompileTime: true,
        }
      );

      const { outputBuffer, dimensionsBuffer, paramBuffer, layout, pipeline, workgroups, iterations, hasIterations, compileTime } = prep;
      const startExec = performance.now();

      // Execute shader with GPU error scope handling
      const device = context.getDevice();
      await withGPUErrorScope(device, 'shader execution', async () => {
        if (hasIterations) {
          // Feedback loop with texture ping-pong
          await executeFeedbackLoop(
            device,
            superDimensions,
            iterations,
            outputBuffer,
            '',
            async (ctx) => {
              // Create bind group with prevFrame texture from feedback loop
              const bindGroup = pipelineBuilder.createStandardBindGroup(
                layout,
                coordTexture,
                coordSampler,
                outputBuffer,
                dimensionsBuffer,
                paramBuffer,
                ctx.prevTexture,
                ctx.prevSampler
              );

              // Execute compute shader
              const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
              await executor.execute(executionContext);
            }
          );
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
      });

      const execTime = performance.now() - startExec;

      // Apply gamma/contrast post-processing (in linear RGB space)
      const postProcessStart = performance.now();
      const processedBuffer = await withGPUErrorScope(device, 'post-processing', async () => {
        return await postProcessor.applyGammaContrast(
          outputBuffer,
          superDimensions,
          globalParams.gamma,
          globalParams.contrast
        );
      });
      const postProcessTime = performance.now() - postProcessStart;

      // Downsample on GPU, then convert to ImageData
      const downsampleStart = performance.now();
      const imageData = await withGPUErrorScope(device, 'downsampling', async () => {
        const downsampledBuffer = resultRenderer.downsample(processedBuffer, superDimensions, dimensions, supersampleFactor);
        return await resultRenderer.bufferToImageData(downsampledBuffer, dimensions);
      });
      const downsampleTime = performance.now() - downsampleStart;

      const totalTime = (compileTime ?? 0) + execTime + postProcessTime + downsampleTime;

      // Log execution time
      addLog(
        `Rendered "${shader.name}": compile ${(compileTime ?? 0).toFixed(1)}ms + exec ${execTime.toFixed(1)}ms + post ${postProcessTime.toFixed(1)}ms + downsample ${downsampleTime.toFixed(1)}ms = ${totalTime.toFixed(1)}ms (${superDimensions.width}x${superDimensions.height} → ${dimensions.width}x${dimensions.height})`
      );

      // Log slow renders to console for debugging
      if (totalTime > 500) {
        console.warn(`[RENDER] Slow render of "${shader.name}" (${totalTime.toFixed(1)}ms): compile=${(compileTime ?? 0).toFixed(1)}ms, exec=${execTime.toFixed(1)}ms, post=${postProcessTime.toFixed(1)}ms, downsample=${downsampleTime.toFixed(1)}ms`);
      }

      // Update result store
      resultStore.updateResult({
        shaderId,
        imageData,
        executionTime: totalTime,
        timestamp: new Date(),
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
    const childrenCount = EVOLUTION_CONFIG.childrenCount;
    const currentTemp = temperature(); // Get current temperature from signal
    const currentModel = model(); // Get current model from signal
    evolutionStore.startEvolution(shaderId, shader.name, childrenCount, currentTemp, EVOLUTION_CONFIG.experimentsPerChild);

    addLog(`Starting evolution of "${shader.name}" (model: ${currentModel}, temp: ${currentTemp.toFixed(2)}, children: ${childrenCount})`);

    try {
      addLog(`Generating ${childrenCount} shader variations...`);

      // Evolve all children in one batch call with current temperature, model, and baked params
      const results = await shaderEvolver.evolveShaderBatch(shaderWithBakedParams, childrenCount, currentTemp, currentModel);

      addLog(`Received ${results.length} variations, processing...`, 'success');

      // Process each result
      for (let i = 0; i < results.length; i++) {
        const result = results[i];

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
      const errorMsg = getErrorMessage(error, 'Unknown batch evolution error');
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

      // Update shader in store (this handles source, parameters, and parameter values)
      shaderStore.updateShader(shaderId, newSource, newParameters);

      // Also update iterations if they changed
      if (newIterations !== shader.iterations) {
        shaderStore.updateIterationValue(shaderId, newIterations);
      }

      // Clear caches to ensure new shader code is used
      // (without this, cached pipelines and shader modules will use old code)
      compiler.clearCache();
      pipelineBuilder.clearCache();

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

      // Create coordinate texture with zoom/pan
      const coordTexture = await withGPUErrorScope(device, 'coordinate texture creation', async () => {
        return await coordGenerator.createCoordinateTexture(
          superDimensions,
          context,
          globalParams.zoom,
          globalParams.panX,
          globalParams.panY
        );
      });

      const coordSampler = coordGenerator.createCoordinateSampler(context);

      // Prepare shader: compile and create all necessary resources
      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        (id) => shaderStore.getIterationValue(id),
        (id) => shaderStore.getParameterValues(id),
        {
          shader,
          shaderId,
          dimensions: superDimensions,
          labelSuffix: 'hires',
          measureCompileTime: false,
        }
      );

      const { outputBuffer, dimensionsBuffer, paramBuffer, layout, pipeline, workgroups, iterations, hasIterations } = prep;

      addLog(`Rendering at ${superDimensions.width}x${superDimensions.height}...`);

      // Execute shader (with iterations if needed) with GPU error scope handling
      await withGPUErrorScope(device, 'shader execution', async () => {
        if (hasIterations) {
          // Feedback loop with texture ping-pong
          await executeFeedbackLoop(
            device,
            superDimensions,
            iterations,
            outputBuffer,
            'hires',
            async (ctx) => {
              const bindGroup = pipelineBuilder.createStandardBindGroup(
                layout,
                coordTexture,
                coordSampler,
                outputBuffer,
                dimensionsBuffer,
                paramBuffer,
                ctx.prevTexture,
                ctx.prevSampler
              );

              const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
              await executor.execute(executionContext);
            }
          );
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
      });

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

    const mashupCount = EVOLUTION_CONFIG.mashupCount;
    const currentTemp = temperature(); // Use current temperature
    const currentModel = model(); // Use current model
    const parentNames = selectedShaders.map(s => s.name);

    setMashupInProgress(true);
    addLog(`Starting mashup of ${selectedShaders.length} shaders: ${parentNames.join(', ')} (model: ${currentModel}, temp: ${currentTemp.toFixed(2)}, variants: ${mashupCount})`);

    try {
      // Generate mashup variations
      const results = await shaderEvolver.evolveMashup(selectedShaders, mashupCount, currentTemp, currentModel);

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
  };

  /**
   * Render a preview of a shader at a specific size
   */
  const renderShaderPreview = async (shader: ShaderDefinition, size: number): Promise<ImageData | null> => {
    try {
      const dimensions = { width: size, height: size };

      // Create coordinate texture and sampler at preview resolution
      const coordTexture = await coordGenerator.createCoordinateTexture(
        dimensions,
        context,
        1.0, // Default zoom
        0.0, // Default pan X
        0.0  // Default pan Y
      );
      const coordSampler = coordGenerator.createCoordinateSampler(context);

      // Use shader defaults for parameters
      const paramValues = new Map(shader.parameters.map(p => [p.name, p.default]));

      const prep = await prepareShader(
        compiler,
        bufferManager,
        parameterManager,
        pipelineBuilder,
        executor,
        () => shader.iterations || 1,
        () => paramValues,
        {
          shader,
          shaderId: shader.id,
          dimensions,
          labelSuffix: '-preview',
          parameterValues: paramValues,
          measureCompileTime: false,
        }
      );

      const { outputBuffer, dimensionsBuffer, paramBuffer, layout, pipeline, workgroups, iterations, hasIterations } = prep;

      // Execute shader
      const device = context.getDevice();
      await withGPUErrorScope(device, 'preview render', async () => {
        if (hasIterations) {
          await executeFeedbackLoop(
            device,
            dimensions,
            iterations,
            outputBuffer,
            '-preview',
            async (ctx) => {
              const bindGroup = pipelineBuilder.createStandardBindGroup(
                layout,
                coordTexture,
                coordSampler,
                outputBuffer,
                dimensionsBuffer,
                paramBuffer,
                ctx.prevTexture,
                ctx.prevSampler
              );

              const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);
              await executor.execute(executionContext);
            }
          );
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
      });

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
        />

        <main class="app-main">

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
            onRenderPreview={renderShaderPreview}
            onShaderEdit={handleShaderEdit}
            onShaderCompile={handleShaderCompile}
          />

          <Show when={evolutionStore.getMashupResults().length > 0}>
            <MashupResults
              mashups={evolutionStore.getMashupResults()}
              parentNames={evolutionStore.getMashupParentNames()}
              onPromote={handlePromoteChild}
              onClear={handleClearMashupResults}
              onRenderPreview={renderShaderPreview}
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
