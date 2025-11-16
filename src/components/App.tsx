/**
 * Main App Component - Integrates WebGPU engine with UI
 */

import { type Component, onMount, createSignal, createEffect, Show } from 'solid-js';
import { ShaderGrid } from './ShaderGrid';
import WebGPUCheck from './WebGPUCheck';
import { shaderStore, inputStore, resultStore } from '@/stores';
import { getWebGPUContext } from '@/core/engine/WebGPUContext';
import { ShaderCompiler } from '@/core/engine/ShaderCompiler';
import { BufferManager } from '@/core/engine/BufferManager';
import { ParameterManager } from '@/core/engine/ParameterManager';
import { PipelineBuilder } from '@/core/engine/PipelineBuilder';
import { Executor, createExecutionContext } from '@/core/engine/Executor';
import { CoordinateGenerator } from '@/core/input/CoordinateGenerator';
import { ResultRenderer } from '@/core/output/ResultRenderer';
import type { ShaderDefinition } from '@/types/core';

// Import example shader sources
import sineWaveSource from '../shaders/examples/sine-wave.wgsl?raw';
import colorMixerSource from '../shaders/examples/color-mixer.wgsl?raw';
import checkerboardSource from '../shaders/examples/checkerboard.wgsl?raw';
import radialGradientSource from '../shaders/examples/radial-gradient.wgsl?raw';

export const App: Component = () => {
  const [webgpuReady, setWebgpuReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // WebGPU components
  let compiler: ShaderCompiler;
  let bufferManager: BufferManager;
  let parameterManager: ParameterManager;
  let pipelineBuilder: PipelineBuilder;
  let executor: Executor;
  let coordGenerator: CoordinateGenerator;
  let resultRenderer: ResultRenderer;

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

      setWebgpuReady(true);

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

  const executeShader = async (shaderId: string) => {
    try {
      const shader = shaderStore.getShader(shaderId);
      if (!shader) return;

      const dimensions = inputStore.outputDimensions;

      // Generate coordinates
      const coords = coordGenerator.generateGrid(dimensions);
      const coordBuffer = bufferManager.createBufferWithData(
        coords,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'coords'
      );

      // Create output buffer (RGBA format: 4 bytes per pixel)
      const outputSize = dimensions.width * dimensions.height * 4 * 4; // vec4<f32> = 16 bytes per pixel
      const outputBuffer = bufferManager.createBuffer(
        {
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          label: 'output',
        },
        false
      );

      // Compile shader
      const startCompile = performance.now();
      const compilationResult = await compiler.compile(shader.source, shader.name);

      if (!compilationResult.success || !compilationResult.module) {
        throw new Error(`Compilation failed: ${ShaderCompiler.formatErrors(compilationResult.errors)}`);
      }

      const compileTime = performance.now() - startCompile;

      // Create parameter buffer if shader has parameters
      let paramBuffer: GPUBuffer | undefined;
      if (shader.parameters.length > 0) {
        const paramValues = shaderStore.getParameterValues(shaderId);
        paramBuffer = parameterManager.createParameterBuffer(shader.parameters, paramValues);
      }

      // Create bind group layout and bind group
      const hasParams = shader.parameters.length > 0;
      const layout = pipelineBuilder.createStandardLayout(hasParams, false, shader.name);
      const bindGroup = pipelineBuilder.createStandardBindGroup(
        layout,
        coordBuffer,
        outputBuffer,
        paramBuffer
      );

      // Create pipeline
      const pipeline = pipelineBuilder.createPipeline({
        shader: compilationResult.module,
        entryPoint: 'main',
        bindGroupLayouts: [layout],
        label: shader.name,
      });

      // Execute
      const workgroups = executor.calculateWorkgroups(dimensions.width, dimensions.height);
      const executionContext = createExecutionContext(pipeline, bindGroup, workgroups, outputBuffer);

      const startExec = performance.now();
      await executor.execute(executionContext);
      const execTime = performance.now() - startExec;

      // Read result
      const imageData = await resultRenderer.bufferToImageData(outputBuffer, dimensions);

      // Update result store
      resultStore.updateResult({
        shaderId,
        imageData,
        executionTime: compileTime + execTime,
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

          <ShaderGrid
            shaders={shaderStore.getActiveShaders()}
            onParameterChange={handleParameterChange}
          />

          <Show when={resultStore.isProcessing}>
            <div class="processing-indicator">Processing...</div>
          </Show>
        </main>
      </Show>
    </div>
  );
};
