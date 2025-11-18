/**
 * Mashup Results - Display mashup shader variations
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import { ChangelogModal } from './ChangelogModal';
import type { ShaderDefinition } from '@/types/core';
import { resultStore } from '@/stores';

interface MashupResultsProps {
  mashups: ShaderDefinition[];
  parentNames: string[];
  onPromote: (mashup: ShaderDefinition) => void;
  onClear: () => void;
}

export const MashupResults: Component<MashupResultsProps> = (props) => {
  const [changelogShader, setChangelogShader] = createSignal<ShaderDefinition | null>(null);

  return (
    <div class="mashup-results">
      <div class="mashup-results-header">
        <div>
          <h4 class="mashup-header">
            Mashup Results ({props.mashups.length})
          </h4>
          <p class="mashup-parents">
            Combined from: {props.parentNames.join(', ')}
          </p>
        </div>
        <button
          onClick={props.onClear}
          class="mashup-clear-results-button"
          title="Clear mashup results"
        >
          Clear Results
        </button>
      </div>

      <div class="mashup-cards">
        <For each={props.mashups}>
          {(mashup) => {
            const result = () => resultStore.getResult(mashup.id);

            return (
              <div class="mashup-card">
                <Show when={result()}>
                  {(r) => {
                    let canvasRef: HTMLCanvasElement | undefined;

                    // Draw result to canvas
                    setTimeout(() => {
                      if (canvasRef) {
                        const ctx = canvasRef.getContext('2d');
                        if (ctx) {
                          ctx.putImageData(r().imageData, 0, 0);
                        }
                      }
                    }, 0);

                    return (
                      <canvas
                        ref={canvasRef}
                        width={r().imageData.width}
                        height={r().imageData.height}
                        class="mashup-canvas"
                      />
                    );
                  }}
                </Show>

                <div class="mashup-info">
                  <div class="mashup-name">{mashup.name}</div>
                  <div class="mashup-buttons">
                    <button
                      onClick={() => props.onPromote(mashup)}
                      class="promote-button"
                      title="Add to main grid"
                    >
                      Promote
                    </button>
                    <Show when={mashup.changelog}>
                      <button
                        onClick={() => setChangelogShader(mashup)}
                        class="mashup-changelog-button"
                        title="View changelog"
                      >
                        ❓
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* Changelog Modal */}
      <Show when={changelogShader() && changelogShader()!.changelog}>
        <ChangelogModal
          shaderName={changelogShader()!.name}
          changelog={changelogShader()!.changelog!}
          onClose={() => setChangelogShader(null)}
        />
      </Show>
    </div>
  );
};
