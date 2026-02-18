/**
 * Profiling Overlay - Toggleable HUD showing per-frame timing breakdown
 * Uses a Portal to render inside the fullscreen element when browser fullscreen is active.
 */

import { type Component, For, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { FrameProfile } from '@/core/engine/AnimationController';

interface ProfilingOverlayProps {
  profiles: Map<string, FrameProfile>;
  visible: boolean;
  onClose: () => void;
  consoleLog: boolean;
  onConsoleLogToggle: () => void;
}

export const ProfilingOverlay: Component<ProfilingOverlayProps> = (props) => {
  const profileList = createMemo(() => Array.from(props.profiles.values()));

  // Track fullscreen element reactively so Portal re-targets on fullscreen change
  const [portalTarget, setPortalTarget] = createSignal<HTMLElement>(document.body);

  const updatePortalTarget = () => {
    setPortalTarget((document.fullscreenElement as HTMLElement) ?? document.body);
  };

  onMount(() => {
    document.addEventListener('fullscreenchange', updatePortalTarget);
    onCleanup(() => document.removeEventListener('fullscreenchange', updatePortalTarget));
  });

  const avgFps = createMemo(() => {
    const profiles = profileList();
    if (profiles.length === 0) return 0;
    const avgMs = profiles.reduce((sum, p) => sum + p.totalFrameMs, 0) / profiles.length;
    return avgMs > 0 ? 1000 / avgMs : 0;
  });

  const barSegments = (profile: FrameProfile) => {
    const total = profile.totalFrameMs || 1;
    return {
      exec: (profile.shaderExecMs / total) * 100,
      copy: (profile.feedbackCopyMs / total) * 100,
      post: (profile.postProcessMs / total) * 100,
    };
  };

  return (
    <Portal mount={portalTarget()}>
      <div
        class="profiling-overlay"
        classList={{ 'profiling-overlay-visible': props.visible }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="profiling-header">
          <span class="profiling-title">Profiling</span>
          <span class="profiling-fps">{avgFps().toFixed(0)} FPS</span>
          <button class="profiling-close" onClick={props.onClose}>x</button>
        </div>

        <div class="profiling-body">
          <For each={profileList()}>
            {(profile) => {
              const seg = barSegments(profile);
              return (
                <div class="profiling-shader">
                  <div class="profiling-shader-name">{profile.shaderName || profile.shaderId.slice(0, 8)}</div>
                  <div class="profiling-bar">
                    <div class="profiling-bar-exec" style={{ width: `${seg.exec}%` }} />
                    <div class="profiling-bar-copy" style={{ width: `${seg.copy}%` }} />
                    <div class="profiling-bar-post" style={{ width: `${seg.post}%` }} />
                  </div>
                  <div class="profiling-stats">
                    <span>case-{profile.executionCase}</span>
                    <span>iter:{profile.iterations}</span>
                    <span class="profiling-stat-exec">exec:{profile.shaderExecMs.toFixed(1)}</span>
                    <span class="profiling-stat-copy">copy:{profile.feedbackCopyMs.toFixed(1)}</span>
                    <span class="profiling-stat-post">post:{profile.postProcessMs.toFixed(1)}</span>
                    <span>= {profile.totalFrameMs.toFixed(1)}ms</span>
                    <span>{profile.superWidth}x{profile.superHeight}</span>
                  </div>
                </div>
              );
            }}
          </For>

          <label class="profiling-console-toggle">
            <input
              type="checkbox"
              checked={props.consoleLog}
              onChange={props.onConsoleLogToggle}
            />
            Console log
          </label>
        </div>

        <div class="profiling-legend">
          <span class="profiling-legend-exec">exec</span>
          <span class="profiling-legend-copy">copy</span>
          <span class="profiling-legend-post">post</span>
        </div>
      </div>
    </Portal>
  );
};
