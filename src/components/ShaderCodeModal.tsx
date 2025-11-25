/**
 * Shader Code Modal - View and edit shader source code with syntax highlighting
 */

import { type Component, onMount, createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';
import { linter, type Diagnostic, forceLinting, lintGutter } from '@codemirror/lint';

interface ShaderCodeModalProps {
  shaderName: string;
  shaderSource: string;
  onClose: () => void;
  onSave?: (newSource: string) => Promise<{ success: boolean; error?: string }>;
  onCompile?: (source: string) => Promise<{ success: boolean; errors?: Array<{ message: string; line?: number; column?: number }> }>;
}

export const ShaderCodeModal: Component<ShaderCodeModalProps> = (props) => {
  let editorContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  const [isSaving, setIsSaving] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [hasChanges, setHasChanges] = createSignal(false);
  const [isCompiling, setIsCompiling] = createSignal(false);
  const [compilationErrors, setCompilationErrors] = createSignal<Array<{ message: string; line?: number; column?: number }>>([]);

  let compileTimeout: number | undefined;

  // Determine if editing is enabled
  const isEditable = () => props.onSave !== undefined;

  // Debounced compilation function
  const scheduleCompilation = (source: string) => {
    if (!props.onCompile) return;

    // Clear existing timeout
    if (compileTimeout !== undefined) {
      clearTimeout(compileTimeout);
    }

    // Schedule compilation after 500ms of no typing
    compileTimeout = setTimeout(async () => {
      console.log('[Compile] Starting compilation...');
      setIsCompiling(true);
      const result = await props.onCompile!(source);
      setIsCompiling(false);

      console.log('[Compile] Compilation result:', result);

      if (result.success) {
        console.log('[Compile] Success - clearing errors');
        setCompilationErrors([]);
      } else {
        console.log('[Compile] Failed with errors:', result.errors);
        setCompilationErrors(result.errors || []);
      }
    }, 500) as unknown as number;
  };

  // Create linter that shows compilation errors inline
  const shaderLinter = linter((view) => {
    const errors = compilationErrors();
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc;

    console.log('[Linter] Running linter with errors:', errors);
    console.log('[Linter] Document has', doc.lines, 'lines');

    for (const error of errors) {
      console.log('[Linter] Processing error:', error);

      if (error.line !== undefined && error.line > 0) {
        try {
          // CodeMirror lines are 1-based in the doc.line() API
          const lineObj = doc.line(error.line);
          const col = error.column !== undefined ? Math.min(error.column - 1, lineObj.length) : 0;
          const from = lineObj.from + col;
          const to = Math.min(from + 1, lineObj.to); // Highlight at least one character

          console.log('[Linter] Created diagnostic at line', error.line, 'from', from, 'to', to);

          diagnostics.push({
            from,
            to,
            severity: 'error',
            message: error.message,
          });
        } catch (e) {
          console.log('[Linter] Error accessing line', error.line, ':', e);
          // If line is out of range, show error at document start
          diagnostics.push({
            from: 0,
            to: 1,
            severity: 'error',
            message: `${error.message} (line ${error.line})`,
          });
        }
      } else {
        console.log('[Linter] Error has no line number, adding at start of doc');
        // Error without line number - show at start
        diagnostics.push({
          from: 0,
          to: 1,
          severity: 'error',
          message: error.message,
        });
      }
    }

    console.log('[Linter] Returning diagnostics:', diagnostics);
    return diagnostics;
  });

  // Force linter to rerun when compilation errors change
  createEffect(() => {
    compilationErrors(); // Track dependency
    if (editorView) {
      forceLinting(editorView);
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (compileTimeout !== undefined) {
      clearTimeout(compileTimeout);
    }
  });

  onMount(() => {
    if (editorContainer) {
      const state = EditorState.create({
        doc: props.shaderSource,
        extensions: [
          basicSetup,
          rust(), // Rust syntax is similar to WGSL
          oneDark,
          EditorView.editable.of(isEditable()),
          EditorView.lineWrapping,
          lintGutter(), // Add gutter for error markers
          shaderLinter, // Add linter for inline error markers
          // Track changes
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setHasChanges(true);
              setErrorMessage(null); // Clear error when user makes changes

              // Trigger debounced compilation if onCompile is provided
              if (props.onCompile && isEditable()) {
                const source = update.state.doc.toString();
                scheduleCompilation(source);
              }
            }
          }),
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
    const currentCode = editorView?.state.doc.toString() || props.shaderSource;
    navigator.clipboard.writeText(currentCode);
  };

  const handleSave = async () => {
    if (!props.onSave || !editorView) return;

    const newSource = editorView.state.doc.toString();
    setIsSaving(true);
    setErrorMessage(null);

    const result = await props.onSave(newSource);

    setIsSaving(false);

    if (result.success) {
      setHasChanges(false);
      props.onClose();
    } else {
      setErrorMessage(result.error || 'Failed to save shader');
    }
  };

  const handleCancel = () => {
    if (hasChanges()) {
      if (confirm('You have unsaved changes. Are you sure you want to close?')) {
        props.onClose();
      }
    } else {
      props.onClose();
    }
  };

  return (
    <Portal>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content shader-code-modal">
          <div class="modal-header">
            <h3>{props.shaderName} {isEditable() && hasChanges() && <span class="unsaved-indicator">*</span>}</h3>
            <div class="modal-actions">
              <button onClick={copyToClipboard} class="copy-button" title="Copy code">
                📋 Copy
              </button>
              <Show when={isEditable()}>
                <button
                  onClick={handleSave}
                  class="save-button"
                  title="Save changes"
                  disabled={isSaving() || !hasChanges()}
                >
                  {isSaving() ? '💾 Saving...' : '💾 Save'}
                </button>
              </Show>
              <button
                onClick={isEditable() ? handleCancel : props.onClose}
                class="close-button"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
          <Show when={errorMessage()}>
            <div class="shader-error-message">
              <strong>Save Error:</strong> {errorMessage()}
            </div>
          </Show>
          <Show when={isCompiling()}>
            <div class="shader-status-message compiling">
              Checking syntax...
            </div>
          </Show>
          <Show when={!isCompiling() && compilationErrors().length > 0}>
            <div class="shader-status-message has-errors">
              {compilationErrors().length} error{compilationErrors().length > 1 ? 's' : ''} found
            </div>
          </Show>
          <Show when={!isCompiling() && compilationErrors().length === 0 && hasChanges()}>
            <div class="shader-status-message valid">
              ✓ Syntax valid
            </div>
          </Show>
          <div class="modal-body">
            <div ref={editorContainer} class="code-editor-container" />
          </div>
        </div>
      </div>
    </Portal>
  );
};
