/**
 * Mashup Toolbar - Shows when shaders are selected for mashup
 */

import { type Component, Show } from 'solid-js';
import { shaderStore } from '@/stores';

interface MashupToolbarProps {
  onMashup: () => void;
  onClear: () => void;
}

export const MashupToolbar: Component<MashupToolbarProps> = (props) => {
  const selectedShaders = () => shaderStore.getMashupSelected();
  const selectionCount = () => shaderStore.getMashupSelectionCount();
  const canMashup = () => selectionCount() >= 2;

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
          <button
            onClick={props.onClear}
            class="mashup-clear-button"
          >
            Clear
          </button>
          <button
            onClick={props.onMashup}
            class="mashup-create-button"
            disabled={!canMashup()}
            title={canMashup() ? 'Create mashup variations' : 'Select at least 2 shaders'}
          >
            🎨 Create Mashup ({selectionCount() >= 2 ? '6 variants' : 'need 2+'})
          </button>
        </div>
      </div>
    </Show>
  );
};
