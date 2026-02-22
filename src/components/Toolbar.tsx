/**
 * Toolbar - Global controls for the application
 */

import { type Component, createSignal, Show } from 'solid-js';
import { apiKey } from '@/stores/apiKeyStore';
import { ApiKeyModal } from './ApiKeyModal';

interface ToolbarProps {
  temperature: number;
  model: string;
  onTemperatureChange: (value: number) => void;
  onModelChange: (model: string) => void;
  onImportShaders: () => void;
  onExportAllShaders: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [apiKeyModalOpen, setApiKeyModalOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);

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
          <option value="claude-sonnet-4-6">Sonnet 4.6 (balanced)</option>
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
          step="0.01"
          value={props.temperature}
          onInput={handleSliderChange}
        />
      </div>

      <div class="toolbar-section toolbar-actions">
        <button
          class="toolbar-button api-key-button"
          onClick={() => setApiKeyModalOpen(true)}
          title={apiKey() ? 'API key is set' : 'Set your Anthropic API key'}
        >
          <span class={`api-key-dot ${apiKey() ? 'active' : 'inactive'}`} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          API Key
        </button>
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
        <button
          class="toolbar-button about-button"
          onClick={() => setAboutOpen(true)}
          title="About Shader Soup"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
          </svg>
          About
        </button>
      </div>

      <ApiKeyModal open={apiKeyModalOpen()} onClose={() => setApiKeyModalOpen(false)} />

      <Show when={aboutOpen()}>
        <div class="modal-overlay" onClick={() => setAboutOpen(false)}>
          <div class="modal-content about-modal" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3>About Shader Soup</h3>
              <button class="close-button" onClick={() => setAboutOpen(false)}>&times;</button>
            </div>
            <div class="modal-body about-body">
              <p>
                Shader Soup is an investigation into AI creativity. I wanted to give it the bare minimum of tools
                and see what it could come up with on its own, using prompts that push it to be creative and think
                out of the box.
              </p>
              <p>
                It starts with this prompt: <em>"You are a highly creative WebGPU shader developer. Your goal is to
                create something new, unique and beautiful by evolving the input shaders, adding your own ideas,
                refactoring and modifying according to the temperature. Think about symmetry, color, texture, light
                and shadow."</em>
              </p>
              <p>
                The framework gives each shader the current time, a set of UV coordinates, current parameter values,
                and the previous frame (a texture) as inputs. The evolver produces new shaders, along with parameter
                definitions and default values and names. There's a small set of built-in primitives. Anything else,
                the agent can invent for itself — which it often does.
              </p>
              <p>
                The UI lets you evolve "children" from any shader, or mash up multiple shaders to produce offspring.
                Mousing over a shader runs it in real time. Pressing <kbd>F</kbd> enters full-screen mode. You can
                adjust param values and global params like pan/zoom and color (gamma and contrast). You can also
                hand-edit the generated source code for any shader in the syntax-checking editor. You can download
                high-res still images, and export the shaders for use elsewhere.
              </p>

              <h4>Costs</h4>
              <p>
                To use this app, you need an Anthropic API key from{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                  console.anthropic.com
                </a>.
                In my experiments, evolving with Haiku (fastest and cheapest) costs around $0.10–0.20 for 6 children,
                Sonnet 4.6 costs $0.75–0.85, and Opus 4.6 (by far the best, but also most expensive) costs around $5
                for 6 children, or $3.50 for a mashup with 4 children, so be careful with Opus especially! The app
                reports the cost for each operation as it goes; check the Evolution Log at the bottom.
              </p>

              <h4>Built-in Shader Library</h4>
              <p>
                All shaders automatically have access to ~60 utility functions from two WGSL libraries, plus all
                standard WebGPU functions:
              </p>
              <ul>
                <li><strong>Noise & Procedural:</strong> hash functions, value/Perlin/simplex noise, FBM variants, turbulence, cellular noise, ridge noise, domain warping</li>
                <li><strong>Math & Color:</strong> saturate, remap, wrap, repeat, pingpong, smooth min/max; HSV/RGB/sRGB conversions; fast exp/log approximations</li>
                <li><strong>Geometry & SDFs:</strong> 2D signed distance functions for triangles, pentagons, hexagons, octagons, stars; radial symmetry; hex grid</li>
                <li><strong>Compositing & Coordinates:</strong> screen blend, normalized UV with zoom/pan, matrix helpers</li>
              </ul>

              <h4>Keyboard Shortcuts</h4>
              <ul>
                <li><kbd>F</kbd> — Full-screen shader (while hovering)</li>
                <li><kbd>R</kbd> or <kbd>0</kbd> — Reset all animations</li>
                <li><kbd>P</kbd> — Toggle profiling overlay</li>
              </ul>

              <h4>Author</h4>
              <p>
                Created by Gary Oberbrunner.{' '}
                <a href="https://blog.oberbrunner.com" target="_blank" rel="noopener noreferrer">Blog</a>{' | '}
                <a href="https://www.linkedin.com/in/garyoberbrunner/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
              </p>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
