/**
 * Toolbar - Global controls for the application
 */

import { type Component } from 'solid-js';

interface ToolbarProps {
  temperature: number;
  model: string;
  onTemperatureChange: (value: number) => void;
  onModelChange: (model: string) => void;
  onImportShaders: () => void;
  onExportAllShaders: () => void;
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
        <h1>Shader Soup</h1>
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
          <option value="claude-opus-4-6">Opus 4.6 (best)</option>
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

      <div class="toolbar-section toolbar-actions">
        <button
          class="toolbar-button import-button"
          onClick={props.onImportShaders}
          title="Import shader(s) from ZIP file"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
          </svg>
          Import
        </button>
        <button
          class="toolbar-button export-button"
          onClick={props.onExportAllShaders}
          title="Export all shaders as ZIP file"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
          Export All
        </button>
      </div>
    </div>
  );
};
