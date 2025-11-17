/**
 * Children Grid - Display evolved shader children
 */

import { type Component, For, Show } from 'solid-js';
import type { ShaderDefinition } from '@/types/core';
import { resultStore } from '@/stores';

interface ChildrenGridProps {
  children: ShaderDefinition[];
  onPromote: (child: ShaderDefinition) => void;
}

export const ChildrenGrid: Component<ChildrenGridProps> = (props) => {
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
                        class="child-canvas"
                      />
                    );
                  }}
                </Show>

                <div class="child-info">
                  <div class="child-name">{child.name}</div>
                  <button
                    onClick={() => props.onPromote(child)}
                    class="promote-button"
                    title="Add to main grid"
                  >
                    Promote
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
