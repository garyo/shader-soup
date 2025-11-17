/**
 * Log Overlay - Displays evolution process logs
 */

import { type Component, For, onMount, onCleanup } from 'solid-js';

export interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'error' | 'success';
}

interface LogOverlayProps {
  logs: LogEntry[];
  isOpen: boolean;
  onToggle: () => void;
}

export const LogOverlay: Component<LogOverlayProps> = (props) => {
  let logContainerRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when new logs appear
  const scrollToBottom = () => {
    if (logContainerRef) {
      logContainerRef.scrollTop = logContainerRef.scrollHeight;
    }
  };

  // Watch for new logs and scroll
  onMount(() => {
    const observer = new MutationObserver(scrollToBottom);
    if (logContainerRef) {
      observer.observe(logContainerRef, { childList: true, subtree: true });
    }
    onCleanup(() => observer.disconnect());
  });

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div class={`log-overlay ${props.isOpen ? 'log-overlay-open' : ''}`}>
      <div class="log-overlay-header" onClick={props.onToggle}>
        <div class="log-overlay-title">
          Evolution Log
          <span class="log-overlay-count">({props.logs.length} entries)</span>
        </div>
        <div class="log-overlay-toggle">
          {props.isOpen ? '▼' : '▲'}
        </div>
      </div>

      <div class="log-overlay-content" ref={logContainerRef}>
        <For each={props.logs}>
          {(log) => (
            <div class={`log-entry log-entry-${log.type}`}>
              <span class="log-timestamp">{formatTime(log.timestamp)}</span>
              <span class="log-message">{log.message}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
