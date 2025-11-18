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
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                          <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
                        </svg>
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
