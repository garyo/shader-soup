/**
 * Result Store - Manage shader execution results
 */

import { createStore } from 'solid-js/store';
import type { ShaderResult } from '@/types/core';

interface ResultState {
  results: Map<string, ShaderResult>;
  isProcessing: boolean;
  errors: Map<string, string>;
}

const [state, setState] = createStore<ResultState>({
  results: new Map(),
  isProcessing: false,
  errors: new Map(),
});

export const resultStore = {
  get results() {
    return state.results;
  },

  get isProcessing() {
    return state.isProcessing;
  },

  get errors() {
    return state.errors;
  },

  /**
   * Update result for a shader
   */
  updateResult(result: ShaderResult) {
    setState('results', (results) => {
      const newResults = new Map(results);
      newResults.set(result.shaderId, result);
      return newResults;
    });

    // Clear error for this shader if it exists
    setState('errors', (errors) => {
      const newErrors = new Map(errors);
      newErrors.delete(result.shaderId);
      return newErrors;
    });
  },

  /**
   * Set error for a shader
   */
  setError(shaderId: string, error: string) {
    setState('errors', (errors) => {
      const newErrors = new Map(errors);
      newErrors.set(shaderId, error);
      return newErrors;
    });
  },

  /**
   * Clear error for a shader
   */
  clearError(shaderId: string) {
    setState('errors', (errors) => {
      const newErrors = new Map(errors);
      newErrors.delete(shaderId);
      return newErrors;
    });
  },

  /**
   * Get result for a shader
   */
  getResult(shaderId: string): ShaderResult | undefined {
    return state.results.get(shaderId);
  },

  /**
   * Get error for a shader
   */
  getError(shaderId: string): string | undefined {
    return state.errors.get(shaderId);
  },

  /**
   * Set processing state
   */
  setProcessing(processing: boolean) {
    setState('isProcessing', processing);
  },

};
