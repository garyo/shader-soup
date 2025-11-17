/**
 * Evolution Status - Display real-time evolution progress
 */

import { type Component, Show } from 'solid-js';
import type { EvolutionProgress } from '@/stores';

interface EvolutionStatusProps {
  progress: EvolutionProgress;
  onCancel: () => void;
}

export const EvolutionStatus: Component<EvolutionStatusProps> = (props) => {
  const progressPercent = () => {
    const childProgress = (props.progress.currentChild / props.progress.totalChildren) * 100;
    return Math.min(childProgress, 100);
  };

  const statusText = () => {
    switch (props.progress.status) {
      case 'mutating':
        return 'Mutating shader...';
      case 'debugging':
        return `Debugging (attempt ${props.progress.debugAttempt}/${props.progress.maxDebugAttempts})`;
      case 'naming':
        return 'Updating parameter names...';
      case 'complete':
        return 'Evolution complete!';
      case 'failed':
        return 'Evolution failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Processing...';
    }
  };

  const elapsedTime = () => {
    const elapsed = Date.now() - props.progress.startTime.getTime();
    return Math.floor(elapsed / 1000);
  };

  return (
    <div class="evolution-status">
      <div class="evolution-header">
        <h4>Evolving: {props.progress.shaderName}</h4>
        <button onClick={props.onCancel} class="cancel-button" title="Cancel evolution">
          ✕
        </button>
      </div>

      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" style={{ width: `${progressPercent()}%` }} />
        </div>
        <div class="progress-text">
          Child {props.progress.currentChild}/{props.progress.totalChildren} • {statusText()}
        </div>
      </div>

      <div class="evolution-meta">
        <span class="temperature">Temperature: {props.progress.temperature.toFixed(1)}</span>
        <span class="elapsed-time">{elapsedTime()}s elapsed</span>
      </div>

      <Show when={props.progress.lastError}>
        <div class="evolution-error">
          <strong>Error:</strong> {props.progress.lastError}
        </div>
      </Show>
    </div>
  );
};
