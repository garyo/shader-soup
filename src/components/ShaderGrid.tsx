/**
 * Shader Grid - Display grid of shader results
 */

import { type Component, For } from 'solid-js';
import { ShaderCard } from './ShaderCard';
import { resultStore } from '@/stores';
import type { ShaderDefinition } from '@/types/core';
import type { GlobalParameters } from '@/stores/shaderStore';

interface ShaderGridProps {
  shaders: ShaderDefinition[];
  onParameterChange: (shaderId: string, paramName: string, value: number) => void;
  onIterationChange: (shaderId: string, value: number) => void;
  onGlobalParameterChange: (shaderId: string, paramName: keyof GlobalParameters, value: number) => void;
  onGlobalParametersReset: (shaderId: string) => void;
  onEvolve: (shaderId: string) => void;
  onCancelEvolution: (shaderId: string) => void;
  onPromoteChild: (child: ShaderDefinition) => void;
  onMashupToggle: (shaderId: string) => void;
  onDeleteShader: (shaderId: string) => void;
  onDownloadShader: (shaderId: string) => void;
  onRenderPreview: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onShaderEdit: (shaderId: string, newSource: string) => Promise<{ success: boolean; error?: string }>;
  onShaderCompile: (source: string) => Promise<{ success: boolean; errors?: Array<{ message: string; line?: number; column?: number }> }>;
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
            onIterationChange={(value) => props.onIterationChange(shader.id, value)}
            onGlobalParameterChange={(paramName, value) =>
              props.onGlobalParameterChange(shader.id, paramName, value)
            }
            onGlobalParametersReset={() => props.onGlobalParametersReset(shader.id)}
            onEvolve={props.onEvolve}
            onCancelEvolution={props.onCancelEvolution}
            onPromoteChild={props.onPromoteChild}
            onMashupToggle={props.onMashupToggle}
            onDeleteShader={() => props.onDeleteShader(shader.id)}
            onDownloadShader={() => props.onDownloadShader(shader.id)}
            onRenderPreview={props.onRenderPreview}
            onShaderEdit={props.onShaderEdit}
            onShaderCompile={props.onShaderCompile}
          />
        )}
      </For>
    </div>
  );
};
