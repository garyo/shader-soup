/**
 * Children Grid - Display evolved shader children
 */

import { type Component, For, Show, createSignal, onCleanup } from 'solid-js';
import { ChangelogModal } from './ChangelogModal';
import { HoverPreview } from './HoverPreview';
import type { ShaderDefinition } from '@/types/core';
import { resultStore } from '@/stores';
import { getWebGPUContext } from '@/core/engine/WebGPUContext';
import { CanvasRenderer } from '@/core/engine/CanvasRenderer';

interface ChildrenGridProps {
  children: ShaderDefinition[];
  onPromote: (child: ShaderDefinition) => void;
  onRenderPreview: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onAnimationStart?: (shaderId: string) => void;
  onAnimationStop?: (shaderId: string) => void;
}

export const ChildrenGrid: Component<ChildrenGridProps> = (props) => {
  const [changelogShader, setChangelogShader] = createSignal<ShaderDefinition | null>(null);
  const [previewShader, setPreviewShader] = createSignal<ShaderDefinition | null>(null);
  const [previewPosition, setPreviewPosition] = createSignal({ x: 0, y: 0 });
  let hoverTimer: number | undefined;
  const canvasRenderers = new Map<string, CanvasRenderer>();

  onCleanup(() => {
    canvasRenderers.clear();
  });

  return (
    <div class="children-grid">
      <h4 class="children-header">
        Evolved Children ({props.children.length})
      </h4>

      <div class="children-cards">
        <For each={props.children}>
          {(child) => {
            const result = () => resultStore.getResult(child.id);

            return (
              <div class="child-card">
                <Show when={result()}>
                  {(r) => {
                    let canvasRef: HTMLCanvasElement | undefined;

                    // Render GPU texture to WebGPU canvas (same as main shader cards)
                    setTimeout(async () => {
                      if (!canvasRef || !r().gpuTexture) return;

                      try {
                        const context = await getWebGPUContext();
                        let renderer = canvasRenderers.get(child.id);

                        if (!renderer) {
                          renderer = new CanvasRenderer(context);
                          canvasRenderers.set(child.id, renderer);
                        }

                        renderer.configureCanvas(canvasRef);
                        await renderer.renderToCanvas(r().gpuTexture!);
                      } catch (err) {
                        console.warn('Child canvas rendering failed:', err);
                      }
                    }, 0);

                    return (
                      <canvas
                        ref={canvasRef}
                        width={128}
                        height={128}
                        class="child-canvas"
                        onMouseEnter={(e) => {
                          setPreviewPosition({ x: e.clientX, y: e.clientY });
                          // Clear any existing timer
                          if (hoverTimer !== undefined) {
                            clearTimeout(hoverTimer);
                          }
                          // Set a 1 second delay before showing preview
                          hoverTimer = setTimeout(() => {
                            setPreviewShader(child);
                          }, 1000) as unknown as number;
                        }}
                        onMouseLeave={() => {
                          // Clear timer if mouse leaves before delay expires
                          if (hoverTimer !== undefined) {
                            clearTimeout(hoverTimer);
                            hoverTimer = undefined;
                          }
                        }}
                      />
                    );
                  }}
                </Show>

                <div class="child-info">
                  <div class="child-name">{child.name}</div>
                  <div class="child-buttons">
                    <button
                      onClick={() => props.onPromote(child)}
                      class="promote-button"
                      title="Add to main grid"
                    >
                      Promote
                    </button>
                    <Show when={child.changelog}>
                      <button
                        onClick={() => setChangelogShader(child)}
                        class="child-changelog-button"
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
    </div>
  );
};
