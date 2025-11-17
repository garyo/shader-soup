/**
 * Shader Grid - Display grid of shader results
 */

import { type Component, For } from 'solid-js';
import { ShaderCard } from './ShaderCard';
import { resultStore } from '@/stores';
import type { ShaderDefinition } from '@/types/core';

interface ShaderGridProps {
  shaders: ShaderDefinition[];
  onParameterChange: (shaderId: string, paramName: string, value: number) => void;
  onEvolve: (shaderId: string) => void;
  onCancelEvolution: (shaderId: string) => void;
  onPromoteChild: (child: ShaderDefinition) => void;
}

export const ShaderGrid: Component<ShaderGridProps> = (props) => {
  return (
    <div class="shader-grid">
      <For each={props.shaders}>
        {(shader) => (
          <ShaderCard
            shader={shader}
            result={resultStore.getResult(shader.id)}
            error={resultStore.getError(shader.id)}
            onParameterChange={(paramName, value) =>
              props.onParameterChange(shader.id, paramName, value)
            }
            onEvolve={props.onEvolve}
            onCancelEvolution={props.onCancelEvolution}
            onPromoteChild={props.onPromoteChild}
          />
        )}
      </For>
    </div>
  );
};
