/**
 * Parameter Slider - Control for adjusting shader parameters
 */

import { type Component, createSignal, createEffect } from 'solid-js';
import type { ShaderParameter } from '@/types/core';

interface ParameterSliderProps {
  parameter: ShaderParameter;
  value: number;
  onChange: (value: number) => void;
}

export const ParameterSlider: Component<ParameterSliderProps> = (props) => {
  const [localValue, setLocalValue] = createSignal(props.value);

  createEffect(() => {
    setLocalValue(props.value);
  });

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseFloat(target.value);
    setLocalValue(value);
    props.onChange(value);
  };

  return (
    <div class="parameter-slider">
      <span class="parameter-name">{props.parameter.name}</span>
      <input
        type="range"
        min={props.parameter.min}
        max={props.parameter.max}
        step={props.parameter.step}
        value={localValue()}
        onInput={handleChange}
        class="slider"
      />
      <span class="parameter-value">{localValue().toFixed(2)}</span>
    </div>
  );
};
