/**
 * Evolution Status - Display real-time evolution progress
 */

import { type Component, Show, createSignal, onCleanup } from 'solid-js';
import type { EvolutionProgress } from '@/stores';

interface EvolutionStatusProps {
  progress: EvolutionProgress;
  onCancel: () => void;
}

export const EvolutionStatus: Component<EvolutionStatusProps> = (props) => {
  const [tick, setTick] = createSignal(0);
  const interval = setInterval(() => setTick(t => t + 1), 1000);
  onCleanup(() => clearInterval(interval));

  const isActive = () => !['complete', 'failed', 'cancelled'].includes(props.progress.status);

  const progressPercent = () => {
    // Calculate progress considering both children and experiments per child
    // Total work = totalChildren * (maxExperiments + debugging + compilation)
    // For simplicity, we'll approximate as: totalChildren * maxExperiments
    const totalSteps = props.progress.totalChildren * props.progress.maxExperiments;

    // Completed children contribute fully (all their experiments are done)
    const completedSteps = (props.progress.currentChild - 1) * props.progress.maxExperiments;

    // Current child contributes based on current experiment
    const currentChildSteps = props.progress.currentExperiment;

    const overallProgress = (completedSteps + currentChildSteps) / totalSteps * 100;
    return Math.min(overallProgress, 100);
  };

  const statusText = () => {
    switch (props.progress.status) {
      case 'mutating':
        if (props.progress.currentExperiment > 0) {
          return `Experimenting (${props.progress.currentExperiment}/${props.progress.maxExperiments})...`;
        }
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
    tick(); // subscribe to per-second updates
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
          <Show when={isActive()}><span class="spinner" /></Show>
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
