/**
 * Tabbed Panel - Compact tabbed interface for organizing content
 */

import { type Component, createSignal, type JSX, Show } from 'solid-js';

export interface Tab {
  id: string;
  label: string;
  content: JSX.Element;
}

interface TabbedPanelProps {
  tabs: Tab[];
  defaultTab?: string;
}

export const TabbedPanel: Component<TabbedPanelProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal(props.defaultTab || props.tabs[0]?.id || '');

  return (
    <div class="tabbed-panel">
      <div class="tab-header">
        {props.tabs.map((tab) => (
          <button
            class={`tab-button ${activeTab() === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div class="tab-content">
        {props.tabs.map((tab) => (
          <Show when={activeTab() === tab.id}>
            <div class="tab-panel">{tab.content}</div>
          </Show>
        ))}
      </div>
    </div>
  );
};
