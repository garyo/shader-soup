/**
 * VideoExportDialog - Settings & progress UI for recording shader animations as MP4
 */

import { type Component, createSignal, createEffect, on, Show } from 'solid-js';
import type { VideoExportProgress } from '@/core/output/VideoExporter';

export interface VideoExportSettings {
  width: number;
  height: number;
  duration: number;
  fps: number;
  bitrateMbps: number;
}

type ResolutionPreset = 'shader' | '720p' | '1080p' | '512' | '1024' | 'UHD';

const RESOLUTION_PRESETS: Record<ResolutionPreset, { label: string; width: number; height: number } | null> = {
  shader: null, // uses shader dimensions
  '512': { label: '512 x 512', width: 512, height: 512 },
  '720p': { label: '720p (1280 x 720)', width: 1280, height: 720 },
  '1024': { label: '1024 x 1024', width: 1024, height: 1024 },
  '1080p': { label: '1080p (1920 x 1080)', width: 1920, height: 1080 },
  'UHD': { label: 'UHD (3840 x 2160)', width: 3840, height: 2160 },
};

const FPS_OPTIONS = [24, 30, 60];

export interface VideoExportDialogProps {
  open: boolean;
  shaderName: string;
  shaderWidth: number;
  shaderHeight: number;
  progress: VideoExportProgress | null;
  exporting: boolean;
  onConfirm: (settings: VideoExportSettings) => void;
  onCancel: () => void;
}

export const VideoExportDialog: Component<VideoExportDialogProps> = (props) => {
  const [preset, setPreset] = createSignal<ResolutionPreset>('1024');
  const [duration, setDuration] = createSignal(5);
  const [fps, setFps] = createSignal(30);
  const [bitrateMbps, setBitrateMbps] = createSignal(8);

  // Reset state when modal opens
  createEffect(on(() => props.open, (open) => {
    if (open) {
      setPreset('1024');
      setDuration(5);
      setFps(30);
      setBitrateMbps(8);
    }
  }));

  const resolution = () => {
    const p = preset();
    if (p === 'shader') {
      return { width: props.shaderWidth, height: props.shaderHeight };
    }
    return RESOLUTION_PRESETS[p]!;
  };

  const totalFrames = () => Math.ceil(duration() * fps());

  const estimatedSize = () => {
    const bytes = (bitrateMbps() * 1_000_000 * duration()) / 8;
    if (bytes > 1_000_000) return `~${(bytes / 1_000_000).toFixed(1)} MB`;
    return `~${(bytes / 1_000).toFixed(0)} KB`;
  };

  const qualityLabel = () => {
    const mbps = bitrateMbps();
    if (mbps <= 4) return 'Low';
    if (mbps <= 8) return 'Medium';
    if (mbps <= 16) return 'High';
    if (mbps <= 32) return 'Very High';
    return 'Ultra';
  };

  const handleConfirm = () => {
    const res = resolution();
    props.onConfirm({
      width: res.width,
      height: res.height,
      duration: duration(),
      fps: fps(),
      bitrateMbps: bitrateMbps(),
    });
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget && !props.exporting) {
      props.onCancel();
    }
  };

  const formatEta = (seconds: number) => {
    if (seconds < 1) return '<1s';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  };

  const phaseLabel = (phase: string) => {
    switch (phase) {
      case 'preparing': return 'Preparing shader...';
      case 'rendering': return 'Rendering frames...';
      case 'encoding': return 'Encoding video...';
      case 'finalizing': return 'Finalizing MP4...';
      default: return phase;
    }
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content video-export-modal">
          <div class="modal-header">
            <h3>Record Video</h3>
            <button class="close-button" onClick={props.onCancel} disabled={props.exporting}>&times;</button>
          </div>

          <Show when={!props.exporting} fallback={
            <div class="video-export-body">
              <div class="video-export-phase">{phaseLabel(props.progress?.phase ?? 'preparing')}</div>

              <div class="video-export-progress">
                <div
                  class="video-export-progress-bar"
                  style={{ width: `${props.progress ? (props.progress.currentFrame / props.progress.totalFrames * 100) : 0}%` }}
                />
              </div>

              <div class="video-export-stats">
                <span>Frame {props.progress?.currentFrame ?? 0} / {props.progress?.totalFrames ?? 0}</span>
                <Show when={props.progress && props.progress.eta > 0}>
                  <span class="video-export-eta">ETA: {formatEta(props.progress!.eta)}</span>
                </Show>
              </div>

              <div class="evolve-options-actions">
                <button class="evolve-options-cancel" onClick={props.onCancel}>Cancel</button>
              </div>
            </div>
          }>
            <div class="video-export-body">
              <div class="video-export-shader-name">{props.shaderName}</div>

              {/* Resolution */}
              <div class="evolve-options-field">
                <label class="evolve-options-label">
                  <span>Resolution</span>
                  <span class="evolve-options-value">{resolution().width} x {resolution().height}</span>
                </label>
                <select
                  class="evolve-options-select"
                  value={preset()}
                  onChange={(e) => setPreset(e.currentTarget.value as ResolutionPreset)}
                >
                  <option value="shader">Match shader ({props.shaderWidth} x {props.shaderHeight})</option>
                  <option value="512">512 x 512</option>
                  <option value="720p">720p (1280 x 720)</option>
                  <option value="1024">1024 x 1024</option>
                  <option value="1080p">1080p (1920 x 1080)</option>
                  <option value="UHD">UHD (3840 x 2160)</option>
                </select>
              </div>

              {/* Duration */}
              <div class="evolve-options-field">
                <label class="evolve-options-label">
                  <span>Duration</span>
                  <span class="evolve-options-value">{duration()}s</span>
                </label>
                <input
                  type="range"
                  class="slider"
                  min="1"
                  max="60"
                  step="1"
                  value={duration()}
                  onInput={(e) => setDuration(parseInt(e.currentTarget.value))}
                />
              </div>

              {/* FPS */}
              <div class="evolve-options-field">
                <label class="evolve-options-label">
                  <span>Frame Rate</span>
                  <span class="evolve-options-value">{fps()} fps</span>
                </label>
                <select
                  class="evolve-options-select"
                  value={fps()}
                  onChange={(e) => setFps(parseInt(e.currentTarget.value))}
                >
                  {FPS_OPTIONS.map(f => (
                    <option value={f}>{f} fps</option>
                  ))}
                </select>
              </div>

              {/* Quality / Bitrate */}
              <div class="evolve-options-field">
                <label class="evolve-options-label">
                  <span>Quality</span>
                  <span class="evolve-options-value">{qualityLabel()} ({bitrateMbps()} Mbps)</span>
                </label>
                <input
                  type="range"
                  class="slider"
                  min="2"
                  max="50"
                  step="1"
                  value={bitrateMbps()}
                  onInput={(e) => setBitrateMbps(parseInt(e.currentTarget.value))}
                />
              </div>

              {/* Estimates */}
              <div class="video-export-estimates">
                <span>{totalFrames()} frames</span>
                <span>{estimatedSize()}</span>
              </div>

              <div class="evolve-options-actions">
                <button class="evolve-options-cancel" onClick={props.onCancel}>Cancel</button>
                <button class="evolve-options-go" onClick={handleConfirm}>Record</button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
