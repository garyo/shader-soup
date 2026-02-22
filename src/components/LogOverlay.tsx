/**
 * Log Overlay - Displays evolution process logs
 */

import { type Component, For, createSignal, createEffect, on, onMount, onCleanup } from 'solid-js';

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
  const [userScrolledBack, setUserScrolledBack] = createSignal(false);

  const isNearBottom = () => {
    if (!logContainerRef) return true;
    const threshold = 30;
    return logContainerRef.scrollTop + logContainerRef.clientHeight >= logContainerRef.scrollHeight - threshold;
  };

  const scrollToBottom = () => {
    if (logContainerRef) {
      logContainerRef.scrollTop = logContainerRef.scrollHeight;
    }
  };

  // Auto-scroll when new logs appear (unless user scrolled back)
  onMount(() => {
    const observer = new MutationObserver(() => {
      if (!userScrolledBack()) {
        scrollToBottom();
      }
    });
    if (logContainerRef) {
      observer.observe(logContainerRef, { childList: true, subtree: true });
    }
    onCleanup(() => observer.disconnect());
  });

  // Auto-scroll to bottom when overlay is opened
  createEffect(on(() => props.isOpen, (isOpen) => {
    if (isOpen) {
      setUserScrolledBack(false);
      // Use requestAnimationFrame to ensure DOM is laid out
      requestAnimationFrame(() => scrollToBottom());
    }
  }));

  const handleScroll = () => {
    if (!logContainerRef) return;
    setUserScrolledBack(!isNearBottom());
  };

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
          {props.isOpen ? '\u25BC' : '\u25B2'}
        </div>
      </div>

      <div class="log-overlay-content" ref={logContainerRef} onScroll={handleScroll}>
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
