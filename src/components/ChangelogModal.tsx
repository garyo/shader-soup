/**
 * Changelog Modal - Display shader evolution changelog
 */

import { type Component } from 'solid-js';
import { Portal } from 'solid-js/web';

interface ChangelogModalProps {
  shaderName: string;
  changelog: string;
  onClose: () => void;
}

export const ChangelogModal: Component<ChangelogModalProps> = (props) => {
  const handleOverlayClick = (e: MouseEvent) => {
    // Close modal when clicking overlay (not the content)
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(props.changelog);
  };

  return (
    <Portal>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content changelog-modal">
          <div class="modal-header">
            <h3>Changelog: {props.shaderName}</h3>
            <div class="modal-actions">
              <button onClick={copyToClipboard} class="copy-button" title="Copy changelog">
                📋 Copy
              </button>
              <button onClick={props.onClose} class="close-button" title="Close">
                ✕
              </button>
            </div>
          </div>
          <div class="modal-body">
            <div class="changelog-content">
              <pre>{props.changelog}</pre>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};
