/**
 * Iteration Slider - Control for adjusting feedback iteration count
 */

import { type Component, createSignal, createEffect } from 'solid-js';

interface IterationSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export const IterationSlider: Component<IterationSliderProps> = (props) => {
  const [localValue, setLocalValue] = createSignal(props.value);

  createEffect(() => {
    setLocalValue(props.value);
  });

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    setLocalValue(value);
    props.onChange(value);
  };

  return (
    <div class="parameter-slider">
      <span class="parameter-name">Iterations</span>
      <input
        type="range"
        min={1}
        max={50}
        step={1}
        prop:value={localValue()}
        onInput={handleChange}
        class="slider"
      />
      <span class="parameter-value">{localValue()}</span>
    </div>
  );
};
