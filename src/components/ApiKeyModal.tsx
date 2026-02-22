/**
 * ApiKeyModal - Modal for entering/managing the Anthropic API key
 */

import { type Component, createSignal, Show } from 'solid-js';
import { apiKey, setApiKey } from '@/stores/apiKeyStore';

interface ApiKeyModalProps {
  open: boolean;
  onClose: () => void;
}

export const ApiKeyModal: Component<ApiKeyModalProps> = (props) => {
  const [inputValue, setInputValue] = createSignal('');
  const [showKey, setShowKey] = createSignal(false);

  const handleOpen = () => {
    setInputValue(apiKey());
    setShowKey(false);
  };

  const handleSave = () => {
    setApiKey(inputValue().trim());
    props.onClose();
  };

  const handleClear = () => {
    setApiKey('');
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') props.onClose();
  };

  return (
    <Show when={props.open}>
      {(() => { handleOpen(); return null; })()}
      <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
        <div class="modal-content api-key-modal">
          <div class="modal-header">
            <h3>Anthropic API Key</h3>
            <button class="close-button" onClick={props.onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="api-key-body">
            <p class="api-key-info">
              Your API key is stored locally in your browser and never sent to any server other than the Anthropic API.
            </p>

            <div class="api-key-input-row">
              <input
                type={showKey() ? 'text' : 'password'}
                class="api-key-input"
                placeholder="sk-ant-..."
                value={inputValue()}
                onInput={(e) => setInputValue(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                autofocus
              />
              <button
                class="api-key-toggle-vis"
                onClick={() => setShowKey(!showKey())}
                title={showKey() ? 'Hide key' : 'Show key'}
              >
                <Show when={showKey()} fallback={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                }>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </Show>
              </button>
            </div>

            <div class="api-key-status">
              <span class={`api-key-dot ${apiKey() ? 'active' : 'inactive'}`} />
              <span>{apiKey() ? 'Key is set' : 'No key set'}</span>
            </div>

            <div class="api-key-actions">
              <button class="api-key-btn save" onClick={handleSave}>Save</button>
              <button class="api-key-btn clear" onClick={handleClear}>Clear</button>
            </div>

            <a
              class="api-key-link"
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get an API key from Anthropic Console
            </a>
          </div>
        </div>
      </div>
    </Show>
  );
};
