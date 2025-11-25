/**
 * Hover Preview - Shows a larger 512x512 render when hovering over thumbnails
 */

import { type Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { ShaderDefinition } from '@/types/core';

interface HoverPreviewProps {
  shader: ShaderDefinition;
  mouseX: number;
  mouseY: number;
  onRender: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onClose: () => void;
}

export const HoverPreview: Component<HoverPreviewProps> = (props) => {
  const [imageData, setImageData] = createSignal<ImageData | null>(null);
  const [isRendering, setIsRendering] = createSignal(true);
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  // Re-render whenever the shader changes
  createEffect(async () => {
    const shader = props.shader; // Track this dependency

    // Reset state
    setIsRendering(true);
    setImageData(null);

    // Render the 512x512 version
    const rendered = await props.onRender(shader, 512);
    setImageData(rendered);
    setIsRendering(false);
  });

  // Draw to canvas whenever imageData changes
  createEffect(() => {
    const data = imageData();
    if (canvasRef && data) {
      const ctx = canvasRef.getContext('2d');
      if (ctx) {
        ctx.putImageData(data, 0, 0);
      }
    }
  });

  onMount(() => {
    // Handle ESC key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Handle click outside - use capture phase to handle before other clicks
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    // Use a small delay to avoid closing immediately on the click that opened it
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true);
    }, 100);

    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleClickOutside, true);
    });
  });

  // Position the preview near the cursor, but keep it on screen
  const position = () => {
    const previewSize = 512 + 32; // Canvas size + padding
    const gap = 20; // Gap from cursor

    let left = props.mouseX + gap;
    let top = props.mouseY + gap;

    // Keep within viewport
    if (left + previewSize > window.innerWidth) {
      left = props.mouseX - previewSize - gap;
    }
    if (top + previewSize > window.innerHeight) {
      top = props.mouseY - previewSize - gap;
    }

    // Ensure never offscreen
    left = Math.max(10, Math.min(left, window.innerWidth - previewSize - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - previewSize - 10));

    return { left: `${left}px`, top: `${top}px` };
  };

  return (
    <div
      ref={containerRef}
      class="hover-preview"
      style={position()}
      onMouseLeave={props.onClose}
    >
      <div class="hover-preview-header">
        <div class="hover-preview-title">{props.shader.name}</div>
        <button
          onClick={props.onClose}
          class="hover-preview-close"
          title="Close (ESC)"
        >
          ✕
        </button>
      </div>

      <div class="hover-preview-content">
        <Show when={isRendering()}>
          <div class="hover-preview-loading">Rendering 512×512...</div>
        </Show>

        <Show when={imageData()}>
          <canvas
            ref={canvasRef}
            width={512}
            height={512}
            class="hover-preview-canvas"
          />
        </Show>

        <Show when={!isRendering() && !imageData()}>
          <div class="hover-preview-error">Failed to render preview</div>
        </Show>
      </div>
    </div>
  );
};
