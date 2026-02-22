/**
 * Mashup Toolbar - Shows when shaders are selected for mashup, and displays results after mashup completes
 */

import { type Component, Show, For, createSignal, onCleanup } from 'solid-js';
import { ChangelogModal } from './ChangelogModal';
import { HoverPreview } from './HoverPreview';
import { shaderStore, resultStore } from '@/stores';
import type { ShaderDefinition } from '@/types/core';
import { getWebGPUContext } from '@/core/engine/WebGPUContext';
import { CanvasRenderer } from '@/core/engine/CanvasRenderer';

interface MashupToolbarProps {
  onMashup: () => void;
  onClear: () => void;
  isLoading: boolean;
  mashupCount: number;
  mashupResults: ShaderDefinition[];
  mashupParentNames: string[];
  mashupSummary: string | null;
  onPromoteMashup: (mashup: ShaderDefinition) => void;
  onClearResults: () => void;
  onRenderPreview: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onAnimationStart?: (shaderId: string) => void;
  onAnimationStop?: (shaderId: string) => void;
}

export const MashupToolbar: Component<MashupToolbarProps> = (props) => {
  const selectedShaders = () => shaderStore.getMashupSelected();
  const selectionCount = () => shaderStore.getMashupSelectionCount();
  const canMashup = () => selectionCount() >= 2 && !props.isLoading;
  const hasResults = () => props.mashupResults.length > 0;

  const [changelogShader, setChangelogShader] = createSignal<ShaderDefinition | null>(null);
  const [previewShader, setPreviewShader] = createSignal<ShaderDefinition | null>(null);
  const [previewPosition, setPreviewPosition] = createSignal({ x: 0, y: 0 });
  let hoverTimer: number | undefined;
  const canvasRenderers = new Map<string, CanvasRenderer>();

  onCleanup(() => {
    canvasRenderers.clear();
    if (hoverTimer !== undefined) clearTimeout(hoverTimer);
  });

  // Show toolbar when there are selections OR results
  const isVisible = () => selectionCount() > 0 || hasResults() || props.isLoading;

  return (
    <Show when={isVisible()}>
      <div class={`mashup-toolbar ${hasResults() ? 'mashup-toolbar-expanded' : ''}`}>
        {/* Results section (shown when mashup results exist) */}
        <Show when={hasResults()}>
          <div class="mashup-toolbar-results">
            <div class="mashup-toolbar-results-header">
              <div>
                <span class="mashup-toolbar-results-title">
                  Mashup Results ({props.mashupResults.length})
                </span>
                <span class="mashup-toolbar-results-parents">
                  from: {props.mashupParentNames.join(', ')}
                </span>
                <Show when={props.mashupSummary}>
                  <span class="mashup-toolbar-results-summary">
                    {props.mashupSummary}
                  </span>
                </Show>
              </div>
              <button
                onClick={props.onClearResults}
                class="mashup-clear-results-button mashup-clear-results-button-small"
                title="Clear mashup results"
              >
                Clear Results
              </button>
            </div>
            <div class="mashup-toolbar-results-cards">
              <For each={props.mashupResults}>
                {(mashup) => {
                  const result = () => resultStore.getResult(mashup.id);

                  return (
                    <div class="mashup-toolbar-result-card">
                      <Show when={result()}>
                        {(r) => {
                          let canvasRef: HTMLCanvasElement | undefined;

                          setTimeout(async () => {
                            if (!canvasRef || !r().gpuTexture) return;
                            try {
                              const context = await getWebGPUContext();
                              let renderer = canvasRenderers.get(mashup.id);
                              if (!renderer) {
                                renderer = new CanvasRenderer(context);
                                canvasRenderers.set(mashup.id, renderer);
                              }
                              renderer.configureCanvas(canvasRef);
                              await renderer.renderToCanvas(r().gpuTexture!);
                            } catch (err) {
                              console.warn('Mashup toolbar canvas rendering failed:', err);
                            }
                          }, 0);

                          return (
                            <canvas
                              ref={canvasRef}
                              width={128}
                              height={128}
                              class="mashup-canvas"
                              onMouseEnter={(e) => {
                                setPreviewPosition({ x: e.clientX, y: e.clientY });
                                if (hoverTimer !== undefined) clearTimeout(hoverTimer);
                                hoverTimer = setTimeout(() => {
                                  setPreviewShader(mashup);
                                }, 1000) as unknown as number;
                              }}
                              onMouseLeave={() => {
                                if (hoverTimer !== undefined) {
                                  clearTimeout(hoverTimer);
                                  hoverTimer = undefined;
                                }
                              }}
                            />
                          );
                        }}
                      </Show>
                      <div class="mashup-toolbar-result-info">
                        <div class="mashup-toolbar-result-name" title={mashup.name}>{mashup.name}</div>
                        <div class="mashup-toolbar-result-buttons">
                          <button
                            onClick={() => props.onPromoteMashup(mashup)}
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
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
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
          </div>
        </Show>

        {/* Selection bar (shown when shaders are selected) */}
        <Show when={selectionCount() > 0}>
          <div class="mashup-toolbar-selection">
            <div class="mashup-toolbar-info">
              <span class="mashup-selection-count">
                {selectionCount()} shader{selectionCount() > 1 ? 's' : ''} selected
              </span>
              <span class="mashup-selected-names">
                {selectedShaders().map(s => s.name).join(', ')}
              </span>
            </div>
            <div class="mashup-toolbar-actions">
              <Show when={props.isLoading}>
                <div class="mashup-loading">
                  <div class="spinner"></div>
                  <span>Creating mashup...</span>
                </div>
              </Show>
              <button
                onClick={props.onClear}
                class="mashup-clear-button"
                disabled={props.isLoading}
              >
                Clear
              </button>
              <button
                onClick={props.onMashup}
                class="mashup-create-button"
                disabled={!canMashup()}
                title={canMashup() ? 'Create mashup variations' : props.isLoading ? 'Mashup in progress...' : 'Select at least 2 shaders'}
              >
                {props.isLoading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
                      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
                      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/>
                    </svg>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
                      <path d="M12.433 10.07C14.133 10.585 16 11.15 16 8a8 8 0 1 0-8 8c1.996 0 1.826-1.504 1.649-3.08-.124-1.101-.252-2.237.351-2.92.465-.527 1.42-.237 2.433.07zM8 5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
                    </svg>
                    Create Mashup ({selectionCount() >= 2 ? `${props.mashupCount} variants` : 'need 2+'})
                  </>
                )}
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Changelog Modal */}
      <Show when={changelogShader() && changelogShader()!.changelog}>
        <ChangelogModal
          shaderName={changelogShader()!.name}
          changelog={changelogShader()!.changelog!}
          onClose={() => setChangelogShader(null)}
        />
      </Show>

      {/* Hover Preview */}
      <Show when={previewShader()}>
        <HoverPreview
          shader={previewShader()!}
          mouseX={previewPosition().x}
          mouseY={previewPosition().y}
          onRender={props.onRenderPreview}
          onClose={() => setPreviewShader(null)}
          onAnimationStart={props.onAnimationStart}
          onAnimationStop={props.onAnimationStop}
        />
      </Show>
    </Show>
  );
};
