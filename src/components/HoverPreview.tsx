/**
 * Hover Preview - Shows a larger 512x512 render when hovering over thumbnails
 * Supports animation: starts animating on mount, stops on close.
 */

import { type Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { ShaderDefinition } from '@/types/core';
import { resultStore } from '@/stores';
import { getWebGPUContext } from '@/core/engine/WebGPUContext';
import { CanvasRenderer } from '@/core/engine/CanvasRenderer';

interface HoverPreviewProps {
  shader: ShaderDefinition;
  mouseX: number;
  mouseY: number;
  onRender: (shader: ShaderDefinition, size: number) => Promise<ImageData | null>;
  onClose: () => void;
  onAnimationStart?: (shaderId: string) => void;
  onAnimationStop?: (shaderId: string) => void;
}

export const HoverPreview: Component<HoverPreviewProps> = (props) => {
  const [isRendering, setIsRendering] = createSignal(true);
  const [hasContent, setHasContent] = createSignal(false);
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let rendererState: { current: CanvasRenderer | null } = { current: null };

  // Start animation on mount
  createEffect(async () => {
    const shader = props.shader; // Track this dependency
    setIsRendering(true);
    setHasContent(false);

    // Start animation immediately — first frame will appear via resultStore
    // We avoid doing a 2D canvas render here because getContext('2d') would
    // lock the canvas and prevent WebGPU from using it for animation frames.
    activeAnimationId = shader.id;
    if (props.onAnimationStart) {
      props.onAnimationStart(shader.id);
    } else {
      // No animation support — fall back to static render
      const rendered = await props.onRender(shader, 512);
      if (rendered && canvasRef) {
        const ctx = canvasRef.getContext('2d');
        if (ctx) {
          ctx.putImageData(rendered, 0, 0);
          setHasContent(true);
        }
      }
    }
    setIsRendering(false);
  });

  // Watch resultStore for animation frame updates — render GPU textures to canvas
  createEffect(async () => {
    const result = resultStore.getResult(props.shader.id);
    if (!result?.gpuTexture || !canvasRef) return;

    try {
      if (!rendererState.current) {
        const context = await getWebGPUContext();
        rendererState.current = new CanvasRenderer(context);
        rendererState.current.configureCanvas(canvasRef);
      }

      await rendererState.current.renderToCanvas(result.gpuTexture);
      setHasContent(true);
    } catch (err) {
      // Silently fall back to static render
    }
  });

  // Capture shader ID eagerly so cleanup can reference it after props are gone
  let activeAnimationId: string | null = null;

  onMount(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true);
    }, 100);

    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleClickOutside, true);
      // Stop animation on cleanup (use captured ID since props.shader may be null)
      if (activeAnimationId) {
        props.onAnimationStop?.(activeAnimationId);
        activeAnimationId = null;
      }
      rendererState.current = null;
    });
  });

  // Position the preview in the viewport corner farthest from the mouse
  const position = () => {
    const margin = 20;
    const previewWidth = 512 + 32;   // canvas + padding
    const previewHeight = 512 + 60;  // canvas + header + padding

    const mouseInLeftHalf = props.mouseX < window.innerWidth / 2;
    const mouseInTopHalf = props.mouseY < window.innerHeight / 2;

    const left = mouseInLeftHalf
      ? window.innerWidth - previewWidth - margin
      : margin;
    const top = mouseInTopHalf
      ? window.innerHeight - previewHeight - margin
      : margin;

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

        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          class="hover-preview-canvas"
          style={{ display: hasContent() ? 'block' : 'none' }}
        />

        <Show when={!isRendering() && !hasContent()}>
          <div class="hover-preview-error">Failed to render preview</div>
        </Show>
      </div>
    </div>
  );
};
