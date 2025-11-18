/**
 * Shader Card - Display shader result with parameter controls
 */

import { type Component, createEffect, For, Show, createSignal } from 'solid-js';
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
}

export const ShaderCard: Component<ShaderCardProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const [showCodeModal, setShowCodeModal] = createSignal(false);
  const [showChangelogModal, setShowChangelogModal] = createSignal(false);

  // Draw result to canvas when it changes
  createEffect(() => {
    if (props.result && canvasRef) {
      const ctx = canvasRef.getContext('2d');
      if (ctx) {
        ctx.putImageData(props.result.imageData, 0, 0);
      }
    }
  });

  const paramValues = () => shaderStore.getParameterValues(props.shader.id) || new Map();
  const globalParams = () => shaderStore.getGlobalParameters(props.shader.id);
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
            💾
          </button>
          <button
            class="delete-shader-button"
            onClick={props.onDeleteShader}
            disabled={!shaderStore.isPromoted(props.shader.id)}
            title={shaderStore.isPromoted(props.shader.id) ? "Delete shader" : "Built-in shader (cannot delete)"}
          >
            🗑️
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
                parameters={globalParams()}
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
          📄 Source Code
        </button>
        <Show when={props.shader.changelog}>
          <button onClick={() => setShowChangelogModal(true)} class="changelog-button" title="View changelog">
            ❓
          </button>
        </Show>
      </div>

      {/* Evolution Controls */}
      <Show when={!isEvolving()}>
        <button onClick={() => props.onEvolve(props.shader.id)} class="evolve-button">
          🧬 Evolve
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
        <ChildrenGrid children={children()} onPromote={props.onPromoteChild} />
      </Show>

      {/* Shader Code Modal */}
      <Show when={showCodeModal()}>
        <ShaderCodeModal
          shaderName={props.shader.name}
          shaderSource={props.shader.source}
          onClose={() => setShowCodeModal(false)}
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
