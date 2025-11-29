/**
 * Shader Card - Display shader result with parameter controls
 */

import { type Component, createEffect, For, Show, createSignal, onCleanup } from 'solid-js';
import { ParameterSlider } from './ParameterSlider';
import { IterationSlider } from './IterationSlider';
import { GlobalParametersComponent } from './GlobalParameters';
import { TabbedPanel } from './TabbedPanel';
import { EvolutionStatus } from './EvolutionStatus';
import { ChildrenGrid } from './ChildrenGrid';
import { ShaderCodeModal } from './ShaderCodeModal';
import { ChangelogModal } from './ChangelogModal';
import type { ShaderDefinition, ShaderResult } from '@/types/core';
import { shaderStore, evolutionStore } from '@/stores';
import type { GlobalParameters } from '@/stores/shaderStore';

interface ShaderCardProps {
  shader: ShaderDefinition;
  result?: ShaderResult;
  error?: string;
  onParameterChange: (paramName: string, value: number) => void;
  onIterationChange: (value: number) => void;
  onGlobalParameterChange: (paramName: keyof GlobalParameters, value: number) => void;
  onGlobalParametersReset: () => void;
  onEvolve: (shaderId: string) => void;
  onCancelEvolution: (shaderId: string) => void;
  onPromoteChild: (child: ShaderDefinition) => void;
  onMashupToggle: (shaderId: string) => void;
  onDeleteShader: () => void;
  onDownloadShader: () => void;
  onRenderPreview: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onShaderEdit: (shaderId: string, newSource: string) => Promise<{ success: boolean; error?: string }>;
  onShaderCompile: (source: string) => Promise<{ success: boolean; errors?: Array<{ message: string; line?: number; column?: number }> }>;
}

export const ShaderCard: Component<ShaderCardProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const [showCodeModal, setShowCodeModal] = createSignal(false);
  const [showChangelogModal, setShowChangelogModal] = createSignal(false);

  // Persistent canvas renderer - survives re-renders (store outside reactive scope)
  const rendererState: { current: any | null } = { current: null };

  // Draw result to canvas when it changes
  createEffect(async () => {
    if (props.result && canvasRef) {
      // Match canvas resolution to its actual display size (prevents browser downsampling artifacts)
      const displayWidth = canvasRef.clientWidth;
      const displayHeight = canvasRef.clientHeight;
      if (displayWidth > 0 && displayHeight > 0) {
        canvasRef.width = displayWidth;
        canvasRef.height = displayHeight;
      }
      // Try WebGPU rendering first (zero CPU readback)
      if (props.result.gpuTexture) {
        try {
          // Lazy import and initialize renderer once
          if (!rendererState.current) {
            const { getWebGPUContext } = await import('@/core/engine/WebGPUContext');
            const { CanvasRenderer } = await import('@/core/engine/CanvasRenderer');

            const context = await getWebGPUContext();
            rendererState.current = new CanvasRenderer(context);
            rendererState.current.configureCanvas(canvasRef); // Configure once
          }

          // Render to canvas (reuses configured context)
          await rendererState.current.renderToCanvas(props.result.gpuTexture);
          return; // Success - WebGPU path used
        } catch (err) {
          console.warn('WebGPU canvas rendering failed, falling back to 2D:', err);
          rendererState.current = null; // Reset on error
          // Fall through to 2D canvas
        }
      }

      // Fallback: 2D canvas with ImageData
      const ctx = canvasRef.getContext('2d');
      if (ctx) {
        ctx.putImageData(props.result.imageData, 0, 0);
      }
    }
  });

  const paramValues = () => shaderStore.getParameterValues(props.shader.id) || new Map();
  const evolutionProgress = () => evolutionStore.getProgress(props.shader.id);
  const children = () => evolutionStore.getChildren(props.shader.id);
  const isEvolving = () => evolutionStore.isEvolving(props.shader.id);

  return (
    <div class="shader-card">
      <div class="shader-header">
        <div class="shader-header-left">
          <input
            type="checkbox"
            checked={shaderStore.isMashupSelected(props.shader.id)}
            onChange={() => props.onMashupToggle(props.shader.id)}
            class="mashup-checkbox"
            title="Select for mashup"
          />
          <h3 class="shader-name">{props.shader.name}</h3>
        </div>
        <div class="shader-info">
          {props.result && (
            <span class="execution-time">{props.result.executionTime.toFixed(2)}ms</span>
          )}
          <button
            class="download-shader-button"
            onClick={props.onDownloadShader}
            title="Download 2048x2048 PNG"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="#ddd">
              <path d="M8.5 1a.5.5 0 0 0-1 0v8.793L4.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l3.5-3.5a.5.5 0 0 0-.708-.708L8.5 9.793V1z"/>
              <path d="M2 13.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 0-1h-11a.5.5 0 0 0-.5.5z"/>
            </svg>
          </button>
          <button
            class="delete-shader-button"
            onClick={props.onDeleteShader}
            disabled={!shaderStore.isPromoted(props.shader.id)}
            title={shaderStore.isPromoted(props.shader.id) ? "Delete shader" : "Built-in shader (cannot delete)"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="#dc3545">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="shader-canvas-container">
        <Show
          when={!props.error}
          fallback={
            <div class="shader-error">
              <p>Error:</p>
              <pre>{props.error}</pre>
            </div>
          }
        >
          <canvas
            ref={canvasRef}
            width={props.result?.imageData.width || 512}
            height={props.result?.imageData.height || 512}
            class="shader-canvas"
          />
        </Show>
      </div>

      {/* Tabbed panel for Parameters and Global Controls */}
      <TabbedPanel
        tabs={[
          {
            id: 'params',
            label: 'Params',
            content: (
              <div class="shader-parameters">
                {/* Iteration slider (if shader uses iterations) */}
                <Show when={props.shader.iterations && props.shader.iterations > 1}>
                  <IterationSlider
                    value={shaderStore.getIterationValue(props.shader.id) ?? props.shader.iterations ?? 1}
                    onChange={props.onIterationChange}
                  />
                </Show>

                {/* Parameter sliders */}
                <For each={props.shader.parameters}>
                  {(param) => (
                    <ParameterSlider
                      parameter={param}
                      value={paramValues().get(param.name) ?? param.default}
                      onChange={(value) => props.onParameterChange(param.name, value)}
                    />
                  )}
                </For>

                {/* Show message if no parameters */}
                <Show when={props.shader.parameters.length === 0 && !(props.shader.iterations && props.shader.iterations > 1)}>
                  <div class="no-parameters">No parameters available</div>
                </Show>
              </div>
            ),
          },
          {
            id: 'global',
            label: 'Global',
            content: (
              <GlobalParametersComponent
                shaderId={props.shader.id}
                onChange={props.onGlobalParameterChange}
                onReset={props.onGlobalParametersReset}
              />
            ),
          },
        ]}
        defaultTab="params"
      />

      <Show when={props.shader.description}>
        <div class="shader-description">
          <p>{props.shader.description}</p>
        </div>
      </Show>

      {/* View Code and Changelog Buttons */}
      <div class="shader-actions">
        <button onClick={() => setShowCodeModal(true)} class="view-code-button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
            <path d="M4 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11zM5 3v10h6V3H5z"/>
            <path d="M6 5h4v1H6V5zm0 2h4v1H6V7zm0 2h3v1H6V9z"/>
          </svg>
          Source Code
        </button>
        <Show when={props.shader.changelog}>
          <button onClick={() => setShowChangelogModal(true)} class="changelog-button" title="View changelog">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
              <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
            </svg>
          </button>
        </Show>
      </div>

      {/* Evolution Controls */}
      <Show when={!isEvolving()}>
        <button onClick={() => props.onEvolve(props.shader.id)} class="evolve-button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
            <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1A1.5 1.5 0 0 1 8.5 6v1H14a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 2 7h5.5V6A1.5 1.5 0 0 1 6 4.5v-1zM8.5 5a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1zM0 11.5A1.5 1.5 0 0 1 1.5 10h1A1.5 1.5 0 0 1 4 11.5v1A1.5 1.5 0 0 1 2.5 14h-1A1.5 1.5 0 0 1 0 12.5v-1zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm4.5.5A1.5 1.5 0 0 1 7.5 10h1a1.5 1.5 0 0 1 1.5 1.5v1A1.5 1.5 0 0 1 8.5 14h-1A1.5 1.5 0 0 1 6 12.5v-1zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm4.5.5a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1zm1.5-.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1z"/>
          </svg>
          Evolve
        </button>
      </Show>

      {/* Evolution Status */}
      <Show when={evolutionProgress()}>
        {(progress) => (
          <EvolutionStatus
            progress={progress()}
            onCancel={() => props.onCancelEvolution(props.shader.id)}
          />
        )}
      </Show>

      {/* Evolved Children */}
      <Show when={children().length > 0}>
        <ChildrenGrid
          children={children()}
          onPromote={props.onPromoteChild}
          onRenderPreview={props.onRenderPreview}
        />
      </Show>

      {/* Shader Code Modal */}
      <Show when={showCodeModal()}>
        <ShaderCodeModal
          shaderName={props.shader.name}
          shaderSource={props.shader.source}
          onClose={() => setShowCodeModal(false)}
          onSave={async (newSource) => {
            return await props.onShaderEdit(props.shader.id, newSource);
          }}
          onCompile={props.onShaderCompile}
        />
      </Show>

      {/* Changelog Modal */}
      <Show when={showChangelogModal() && props.shader.changelog}>
        <ChangelogModal
          shaderName={props.shader.name}
          changelog={props.shader.changelog!}
          onClose={() => setShowChangelogModal(false)}
        />
      </Show>
    </div>
  );
};
