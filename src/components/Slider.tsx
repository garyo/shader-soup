/**
 * Slider - Generic compact slider component with name/slider/value on same line
 */

import { type Component, createSignal, createEffect } from 'solid-js';

export interface SliderProps {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export const Slider: Component<SliderProps> = (props) => {
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

  const formatValue = props.formatValue || ((v: number) => v.toFixed(2));

  return (
    <div class="parameter-slider">
      <span class="parameter-name">{props.name}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={localValue()}
        onInput={handleChange}
        class="slider"
      />
      <span class="parameter-value">{formatValue(localValue())}</span>
    </div>
  );
};
