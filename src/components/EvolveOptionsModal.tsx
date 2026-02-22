/**
 * EvolveOptionsModal - Shared modal for Evolve and Mashup options
 * Lets user set children count, temperature, model, and optional special instructions before running.
 */

import { type Component, createSignal, createEffect, on, Show, For } from 'solid-js';

const VALID_MODELS = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
];

export interface EvolveOptionsModalProps {
  open: boolean;
  mode: 'evolve' | 'mashup';
  defaultCount: number;
  temperature: number;
  model: string;
  onConfirm: (opts: { count: number; instructions: string; temperature: number; model: string }) => void;
  onCancel: () => void;
}

export const EvolveOptionsModal: Component<EvolveOptionsModalProps> = (props) => {
  const [count, setCount] = createSignal(props.defaultCount);
  const [temp, setTemp] = createSignal(props.temperature);
  const [selectedModel, setSelectedModel] = createSignal(props.model);
  const [instructions, setInstructions] = createSignal('');
  const [showInstructions, setShowInstructions] = createSignal(false);

  // Reset state when modal opens
  createEffect(on(() => props.open, (open) => {
    if (open) {
      setCount(props.defaultCount);
      setTemp(props.temperature);
      setSelectedModel(props.model);
      setInstructions('');
      setShowInstructions(false);
    }
  }));

  const handleConfirm = () => {
    props.onConfirm({
      count: count(),
      instructions: instructions().trim(),
      temperature: temp(),
      model: selectedModel(),
    });
  };

  const handleCancel = () => {
    props.onCancel();
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  const title = () => props.mode === 'evolve' ? 'Evolve Options' : 'Mashup Options';

  return (
    <Show when={props.open}>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content evolve-options-modal">
          <div class="modal-header">
            <h3>{title()}</h3>
            <button class="close-button" onClick={handleCancel}>&times;</button>
          </div>

          <div class="evolve-options-body">
            {/* Children count */}
            <div class="evolve-options-field">
              <label class="evolve-options-label">
                <span>Children</span>
                <span class="evolve-options-value">{count()}</span>
              </label>
              <input
                type="range"
                class="slider"
                min="1"
                max="10"
                step="1"
                value={count()}
                onInput={(e) => setCount(parseInt(e.currentTarget.value))}
              />
            </div>

            {/* Temperature */}
            <div class="evolve-options-field">
              <label class="evolve-options-label">
                <span>Temperature</span>
                <span class="evolve-options-value">{temp().toFixed(2)}</span>
              </label>
              <input
                type="range"
                class="slider"
                min="0"
                max="1"
                step="0.01"
                value={temp()}
                onInput={(e) => setTemp(parseFloat(e.currentTarget.value))}
              />
            </div>

            {/* Model */}
            <div class="evolve-options-field">
              <label class="evolve-options-label">
                <span>Model</span>
              </label>
              <select
                class="evolve-options-select"
                value={selectedModel()}
                onChange={(e) => setSelectedModel(e.currentTarget.value)}
              >
                <For each={VALID_MODELS}>
                  {(m) => <option value={m.value}>{m.label}</option>}
                </For>
              </select>
            </div>

            {/* Special instructions */}
            <div class="evolve-options-field">
              <button
                class="evolve-options-toggle"
                onClick={() => setShowInstructions(!showInstructions())}
              >
                {showInstructions() ? '▾' : '▸'} Special instructions
              </button>
              <Show when={showInstructions()}>
                <textarea
                  class="evolve-options-textarea"
                  placeholder="e.g. &quot;Use warm colors&quot;, &quot;Make it more geometric&quot;, &quot;Add spirals&quot;..."
                  value={instructions()}
                  onInput={(e) => setInstructions(e.currentTarget.value)}
                  rows={3}
                />
              </Show>
            </div>

            <div class="evolve-options-actions">
              <button class="evolve-options-cancel" onClick={handleCancel}>Cancel</button>
              <button class="evolve-options-go" onClick={handleConfirm}>Go!</button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
