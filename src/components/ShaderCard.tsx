/**
 * Shader Card - Display shader result with parameter controls
 */

import { type Component, createEffect, For, Show, createSignal } from 'solid-js';
import { ParameterSlider } from './ParameterSlider';
import { EvolutionStatus } from './EvolutionStatus';
import { ChildrenGrid } from './ChildrenGrid';
import { ShaderCodeModal } from './ShaderCodeModal';
import type { ShaderDefinition, ShaderResult } from '@/types/core';
import { shaderStore, evolutionStore } from '@/stores';

interface ShaderCardProps {
  shader: ShaderDefinition;
  result?: ShaderResult;
  error?: string;
  onParameterChange: (paramName: string, value: number) => void;
  onEvolve: (shaderId: string) => void;
  onCancelEvolution: (shaderId: string) => void;
  onPromoteChild: (child: ShaderDefinition) => void;
}

export const ShaderCard: Component<ShaderCardProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const [showCodeModal, setShowCodeModal] = createSignal(false);

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
  const evolutionProgress = () => evolutionStore.getProgress(props.shader.id);
  const children = () => evolutionStore.getChildren(props.shader.id);
  const isEvolving = () => evolutionStore.isEvolving(props.shader.id);

  return (
    <div class="shader-card">
      <div class="shader-header">
        <h3 class="shader-name">{props.shader.name}</h3>
        <div class="shader-info">
          {props.result && (
            <span class="execution-time">{props.result.executionTime.toFixed(2)}ms</span>
          )}
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

      <Show when={props.shader.parameters.length > 0}>
        <div class="shader-parameters">
          <For each={props.shader.parameters}>
            {(param) => (
              <ParameterSlider
                parameter={param}
                value={paramValues().get(param.name) ?? param.default}
                onChange={(value) => props.onParameterChange(param.name, value)}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={props.shader.description}>
        <div class="shader-description">
          <p>{props.shader.description}</p>
        </div>
      </Show>

      {/* View Code Button */}
      <button onClick={() => setShowCodeModal(true)} class="view-code-button">
        📄 View Code
      </button>

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
    </div>
  );
};
