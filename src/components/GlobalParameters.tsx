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
  }> = [
    { name: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, default: 0 },
    { name: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
    { name: 'zoom', label: 'Zoom', min: 0.1, max: 10, step: 0.1, default: 1 },
    { name: 'panX', label: 'Pan X', min: -2, max: 2, step: 0.01, default: 0 },
    { name: 'panY', label: 'Pan Y', min: -2, max: 2, step: 0.01, default: 0 },
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
