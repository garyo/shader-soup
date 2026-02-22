/**
 * API Key Store - localStorage-backed reactive signal for Anthropic API key
 */

import { createSignal } from 'solid-js';

const STORAGE_KEY = 'anthropic-api-key';

function readInitialKey(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage may be unavailable
  }
  // Fall back to build-time env var (for local dev convenience)
  return import.meta.env.VITE_ANTHROPIC_API_KEY ?? '';
}

const [apiKey, _setApiKey] = createSignal(readInitialKey());

function setApiKey(key: string) {
  try {
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  _setApiKey(key);
}

export { apiKey, setApiKey };
