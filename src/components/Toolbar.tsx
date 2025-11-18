/**
 * Toolbar - Global controls for the application
 */

import { type Component } from 'solid-js';

interface ToolbarProps {
  temperature: number;
  onTemperatureChange: (value: number) => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const handleSliderChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    props.onTemperatureChange(parseFloat(target.value));
  };

  return (
    <div class="toolbar">
      <div class="toolbar-section">
        <label class="toolbar-label">
          Evolution Temperature
          <span class="toolbar-value">{props.temperature.toFixed(2)}</span>
        </label>
        <input
          type="range"
          class="toolbar-slider"
          min="0"
          max="1"
          step="0.05"
          prop:value={props.temperature}
          onInput={handleSliderChange}
        />
        <div class="toolbar-hint">
          Lower = subtle changes, Higher = more variation
        </div>
      </div>
    </div>
  );
};
