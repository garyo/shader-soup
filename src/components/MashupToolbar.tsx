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
            {props.isLoading ? '⏳ Creating...' : `🎨 Create Mashup (${selectionCount() >= 2 ? '6 variants' : 'need 2+'})`}
          </button>
        </div>
      </div>
    </Show>
  );
};
