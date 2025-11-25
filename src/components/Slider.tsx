/**
 * Slider - Generic compact slider component with name/slider/value on same line
 * Supports both linear and logarithmic scaling
 */

import { type Component, createSignal, createEffect, createMemo } from 'solid-js';

export interface SliderProps {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  scale?: 'linear' | 'log';
}

export const Slider: Component<SliderProps> = (props) => {
  const [localValue, setLocalValue] = createSignal(props.value);
  const [isEditing, setIsEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const scale = props.scale || 'linear';

  createEffect(() => {
    setLocalValue(props.value);
  });

  // Convert actual value to slider position (0-1 for log scale)
  const valueToSliderPosition = (value: number): number => {
    if (scale === 'log') {
      const logMin = Math.log10(props.min);
      const logMax = Math.log10(props.max);
      const logValue = Math.log10(value);
      return (logValue - logMin) / (logMax - logMin);
    }
    return value; // Linear scale uses value directly
  };

  // Convert slider position to actual value
  const sliderPositionToValue = (position: number): number => {
    if (scale === 'log') {
      const logMin = Math.log10(props.min);
      const logMax = Math.log10(props.max);
      const logValue = logMin + position * (logMax - logMin);
      return Math.pow(10, logValue);
    }
    return position; // Linear scale uses position directly
  };

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const sliderPos = parseFloat(target.value);
    const actualValue = sliderPositionToValue(sliderPos);
    setLocalValue(actualValue);
    props.onChange(actualValue);
  };

  const formatValue = props.formatValue || ((v: number) => v.toFixed(2));

  // For log scale, slider operates on 0-1 range; for linear, use actual min/max
  const sliderMin = scale === 'log' ? 0 : props.min;
  const sliderMax = scale === 'log' ? 1 : props.max;
  const sliderStep = scale === 'log' ? 0.001 : props.step;

  // Make sliderValue reactive so it recomputes when localValue changes
  const sliderValue = createMemo(() => {
    return scale === 'log' ? valueToSliderPosition(localValue()) : localValue();
  });

  const handleValueClick = () => {
    setEditText(localValue().toString());
    setIsEditing(true);
  };

  const handleValueChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    setEditText(target.value);
  };

  const handleValueBlur = () => {
    const numValue = parseFloat(editText());
    if (!isNaN(numValue)) {
      // Clamp to min/max
      const clampedValue = Math.max(props.min, Math.min(props.max, numValue));
      setLocalValue(clampedValue);
      props.onChange(clampedValue);
    }
    setIsEditing(false);
  };

  const handleValueKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  return (
    <div class="parameter-slider">
      <span class="parameter-name">{props.name}</span>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={sliderValue()}
        onInput={handleChange}
        class="slider"
      />
      {isEditing() ? (
        <input
          type="text"
          value={editText()}
          onInput={handleValueChange}
          onBlur={handleValueBlur}
          onKeyDown={handleValueKeyDown}
          class="parameter-value-input"
          autofocus
        />
      ) : (
        <span class="parameter-value" onClick={handleValueClick}>
          {formatValue(localValue())}
        </span>
      )}
    </div>
  );
};
