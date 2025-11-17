/**
 * Main App Component - Integrates WebGPU engine with UI
 */

import { type Component, onMount, createSignal, createEffect, Show } from 'solid-js';
import { ShaderGrid } from './ShaderGrid';
import { Toolbar } from './Toolbar';
import { LogOverlay, type LogEntry } from './LogOverlay';
import WebGPUCheck from './WebGPUCheck';
import { shaderStore, inputStore, resultStore, evolutionStore } from '@/stores';
import { getWebGPUContext } from '@/core/engine/WebGPUContext';
import { ShaderCompiler } from '@/core/engine/ShaderCompiler';
import { BufferManager } from '@/core/engine/BufferManager';
import { ParameterManager } from '@/core/engine/ParameterManager';
import { PipelineBuilder } from '@/core/engine/PipelineBuilder';
import { Executor, createExecutionContext } from '@/core/engine/Executor';
import { CoordinateGenerator } from '@/core/input/CoordinateGenerator';
import { ResultRenderer } from '@/core/output/ResultRenderer';
import { ShaderEvolver } from '@/core/llm';
import type { ShaderDefinition } from '@/types/core';

// Import example shader sources
import sineWaveSource from '../shaders/examples/sine-wave.wgsl?raw';
import colorMixerSource from '../shaders/examples/color-mixer.wgsl?raw';
import checkerboardSource from '../shaders/examples/checkerboard.wgsl?raw';
import radialGradientSource from '../shaders/examples/radial-gradient.wgsl?raw';

export const App: Component = () => {
  const [webgpuReady, setWebgpuReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [temperature, setTemperature] = createSignal(0.9); // Default evolution temperature
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [logOverlayOpen, setLogOverlayOpen] = createSignal(false);

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
  let compiler: ShaderCompiler;
  let bufferManager: BufferManager;
  let parameterManager: ParameterManager;
  let pipelineBuilder: PipelineBuilder;
  let executor: Executor;
  let coordGenerator: CoordinateGenerator;
  let resultRenderer: ResultRenderer;
  let shaderEvolver: ShaderEvolver;

  // Initialize WebGPU and load example shaders
  onMount(async () => {
    try {
      // Initialize WebGPU
      const context = await getWebGPUContext();

      // Create engine components
      compiler = new ShaderCompiler(context);
      bufferManager = new BufferManager(context);
      parameterManager = new ParameterManager(bufferManager);
      pipelineBuilder = new PipelineBuilder(context);
      executor = new Executor(context, true); // Enable profiling
      coordGenerator = new CoordinateGenerator();
      resultRenderer = new ResultRenderer(bufferManager, context);

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
    ];

    for (const example of examples) {
      const params = parameterManager.parseParameters(example.source);
      const shader: ShaderDefinition = {
        id: crypto.randomUUID(),
        name: example.name,
        cacheKey: example.name.toLowerCase().replace(/\s+/g, '-'), // e.g., "sine-wave"
        source: example.source,
        parameters: params,
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

      // Generate coordinates at supersampled resolution
      const coords = coordGenerator.generateGrid(superDimensions);
      const coordBuffer = bufferManager.createBufferWithData(
        coords as BufferSource,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'coords'
      );

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

      // Create bind group layout and bind group
      const hasParams = shader.parameters.length > 0;
      const layout = pipelineBuilder.createStandardLayout(hasParams, false, shader.cacheKey);
      const bindGroup = pipelineBuilder.createStandardBindGroup(
        layout,
        coordBuffer,
        outputBuffer,
        dimensionsBuffer,
        paramBuffer
      );

      // Create pipeline
      const pipeline = pipelineBuilder.createPipeline({
        shader: compilationResult.module,
        entryPoint: 'main',
        bindGroupLayouts: [layout],
        label: shader.cacheKey,
      });

      // Execute at supersampled resolution
      const workgroups = executor.calculateWorkgroups(superDimensions.width, superDimensions.height);
      const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);

      const startExec = performance.now();
      await executor.execute(executionContext);
      const execTime = performance.now() - startExec;

      // Downsample on GPU, then convert to ImageData
      const downsampleStart = performance.now();
      const downsampledBuffer = resultRenderer.downsample(outputBuffer, superDimensions, dimensions, supersampleFactor);
      const imageData = await resultRenderer.bufferToImageData(downsampledBuffer, dimensions);
      const downsampleTime = performance.now() - downsampleStart;

      const totalTime = compileTime + execTime + downsampleTime;

      // Log execution time
      addLog(
        `Rendered "${shader.name}": compile ${compileTime.toFixed(1)}ms + exec ${execTime.toFixed(1)}ms + downsample ${downsampleTime.toFixed(1)}ms = ${totalTime.toFixed(1)}ms (${superDimensions.width}x${superDimensions.height} → ${dimensions.width}x${dimensions.height})`
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

  const handleEvolve = async (shaderId: string) => {
    if (!shaderEvolver) {
      alert('Evolution feature requires VITE_ANTHROPIC_API_KEY environment variable');
      return;
    }

    const shader = shaderStore.getShader(shaderId);
    if (!shader) return;

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

      // Evolve all children in one batch call with current temperature
      const results = await shaderEvolver.evolveShaderBatch(shader, childrenCount, currentTemp);

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

  // Re-execute shaders when active shaders change
  createEffect(() => {
    if (webgpuReady()) {
      const activeShaders = shaderStore.getActiveShaders();
      if (activeShaders.length > 0) {
        executeAllShaders();
      }
    }
  });

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
            onEvolve={handleEvolve}
            onCancelEvolution={handleCancelEvolution}
            onPromoteChild={handlePromoteChild}
          />

          <Show when={resultStore.isProcessing}>
            <div class="processing-indicator">Processing...</div>
          </Show>
        </main>
      </Show>

      <LogOverlay
        logs={logs()}
        isOpen={logOverlayOpen()}
        onToggle={() => setLogOverlayOpen(!logOverlayOpen())}
      />
    </div>
  );
};
