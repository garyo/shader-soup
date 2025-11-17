/**
 * Shader Code Modal - View shader source code with syntax highlighting
 */

import { type Component, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';

interface ShaderCodeModalProps {
  shaderName: string;
  shaderSource: string;
  onClose: () => void;
}

export const ShaderCodeModal: Component<ShaderCodeModalProps> = (props) => {
  let editorContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;

  onMount(() => {
    if (editorContainer) {
      const state = EditorState.create({
        doc: props.shaderSource,
        extensions: [
          basicSetup,
          rust(), // Rust syntax is similar to WGSL
          oneDark,
          EditorView.editable.of(false), // Read-only
          EditorView.lineWrapping,
        ],
      });

      editorView = new EditorView({
        state,
        parent: editorContainer,
      });
    }

    // Cleanup on unmount
    return () => {
      editorView?.destroy();
    };
  });

  const handleOverlayClick = (e: MouseEvent) => {
    // Close modal when clicking overlay (not the content)
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(props.shaderSource);
  };

  return (
    <Portal>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content shader-code-modal">
          <div class="modal-header">
            <h3>{props.shaderName}</h3>
            <div class="modal-actions">
              <button onClick={copyToClipboard} class="copy-button" title="Copy code">
                📋 Copy
              </button>
              <button onClick={props.onClose} class="close-button" title="Close">
                ✕
              </button>
            </div>
          </div>
          <div class="modal-body">
            <div ref={editorContainer} class="code-editor-container" />
          </div>
        </div>
      </div>
    </Portal>
  );
};
