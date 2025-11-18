/**
 * Global Parameters - Global visual parameters for shaders
 */

import { type Component, For } from 'solid-js';
import { Slider } from './Slider';
import type { GlobalParameters } from '@/stores/shaderStore';

interface GlobalParametersProps {
  parameters: GlobalParameters;
  onChange: (paramName: keyof GlobalParameters, value: number) => void;
  onReset: () => void;
}

export const GlobalParametersComponent: Component<GlobalParametersProps> = (props) => {
  const parameterDefs: Array<{
    name: keyof GlobalParameters;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
    scale: 'linear' | 'log';
  }> = [
    { name: 'gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.1, default: 1, scale: 'log' },
    { name: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0, scale: 'linear' },
    { name: 'zoom', label: 'Zoom', min: 0.1, max: 10, step: 0.1, default: 1, scale: 'log' },
    { name: 'panX', label: 'Pan X', min: -2, max: 2, step: 0.01, default: 0, scale: 'linear' },
    { name: 'panY', label: 'Pan Y', min: -2, max: 2, step: 0.01, default: 0, scale: 'linear' },
  ];

  return (
    <div class="global-parameters-content">
      <For each={parameterDefs}>
        {(def) => (
          <Slider
            name={def.label}
            value={props.parameters[def.name]}
            min={def.min}
            max={def.max}
            step={def.step}
            scale={def.scale}
            onChange={(value) => props.onChange(def.name, value)}
          />
        )}
      </For>

      <button onClick={props.onReset} class="global-parameters-reset">
        Reset All
      </button>
    </div>
  );
};
