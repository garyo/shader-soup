/**
 * Toolbar - Global controls for the application
 */

import { type Component } from 'solid-js';

interface ToolbarProps {
  temperature: number;
  model: string;
  onTemperatureChange: (value: number) => void;
  onModelChange: (model: string) => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const handleSliderChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    props.onTemperatureChange(parseFloat(target.value));
  };

  const handleModelChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    props.onModelChange(target.value);
  };

  return (
    <div class="toolbar">
      <div class="toolbar-title">
        <h1>Evolve Image Gen</h1>
      </div>

      <div class="toolbar-section">
        <label class="toolbar-label">
          Model
        </label>
        <select
          class="model-select"
          value={props.model}
          onChange={handleModelChange}
        >
          <option value="claude-haiku-4-5">Haiku 4.5 (fast)</option>
          <option value="claude-sonnet-4-5">Sonnet 4.5 (balanced)</option>
          <option value="claude-opus-4-5">Opus 4.5 (best)</option>
        </select>
      </div>

      <div class="toolbar-section">
        <label class="toolbar-label">
          Temperature
          <span class="toolbar-value">{props.temperature.toFixed(2)}</span>
        </label>
        <input
          type="range"
          class="toolbar-slider"
          min="0"
          max="1"
          step="0.05"
          value={props.temperature}
          onInput={handleSliderChange}
        />
      </div>
    </div>
  );
};
