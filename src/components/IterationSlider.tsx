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
  const [isEditing, setIsEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');

  createEffect(() => {
    setLocalValue(props.value);
  });

  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseInt(target.value, 10);
    setLocalValue(value);
    props.onChange(value);
  };

  const handleValueClick = () => {
    setEditText(localValue().toString());
    setIsEditing(true);
  };

  const handleValueChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    setEditText(target.value);
  };

  const handleValueBlur = () => {
    const numValue = parseInt(editText(), 10);
    if (!isNaN(numValue)) {
      // Clamp to min/max (1-50)
      const clampedValue = Math.max(1, Math.min(50, numValue));
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
      <span class="parameter-name">Iterations</span>
      <input
        type="range"
        min={1}
        max={50}
        step={1}
        value={localValue()}
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
          {localValue()}
        </span>
      )}
    </div>
  );
};
