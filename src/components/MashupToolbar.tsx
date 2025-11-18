/**
 * Mashup Toolbar - Shows when shaders are selected for mashup
 */

import { type Component, Show } from 'solid-js';
import { shaderStore } from '@/stores';

interface MashupToolbarProps {
  onMashup: () => void;
  onClear: () => void;
  isLoading: boolean;
}

export const MashupToolbar: Component<MashupToolbarProps> = (props) => {
  const selectedShaders = () => shaderStore.getMashupSelected();
  const selectionCount = () => shaderStore.getMashupSelectionCount();
  const canMashup = () => selectionCount() >= 2 && !props.isLoading;

  return (
    <Show when={selectionCount() > 0}>
      <div class="mashup-toolbar">
        <div class="mashup-toolbar-info">
          <span class="mashup-selection-count">
            {selectionCount()} shader{selectionCount() > 1 ? 's' : ''} selected
          </span>
          <span class="mashup-selected-names">
            {selectedShaders().map(s => s.name).join(', ')}
          </span>
        </div>
        <div class="mashup-toolbar-actions">
          <Show when={props.isLoading}>
            <div class="mashup-loading">
              <div class="spinner"></div>
              <span>Creating mashup...</span>
            </div>
          </Show>
          <button
            onClick={props.onClear}
            class="mashup-clear-button"
            disabled={props.isLoading}
          >
            Clear
          </button>
          <button
            onClick={props.onMashup}
            class="mashup-create-button"
            disabled={!canMashup()}
            title={canMashup() ? 'Create mashup variations' : props.isLoading ? 'Mashup in progress...' : 'Select at least 2 shaders'}
          >
            {props.isLoading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
                  <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
                  <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/>
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;">
                  <path d="M12.433 10.07C14.133 10.585 16 11.15 16 8a8 8 0 1 0-8 8c1.996 0 1.826-1.504 1.649-3.08-.124-1.101-.252-2.237.351-2.92.465-.527 1.42-.237 2.433.07zM8 5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
                </svg>
                Create Mashup ({selectionCount() >= 2 ? '6 variants' : 'need 2+'})
              </>
            )}
          </button>
        </div>
      </div>
    </Show>
  );
};
