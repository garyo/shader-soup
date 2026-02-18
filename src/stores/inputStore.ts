/**
 * Input Store - Manage input settings
 */

import { createStore } from 'solid-js/store';
import type { Dimensions } from '@/types/core';

interface InputState {
  outputDimensions: Dimensions;
}

const [state] = createStore<InputState>({
  outputDimensions: { width: 512, height: 512 },
});

export const inputStore = {
  get outputDimensions() {
    return state.outputDimensions;
  },
};
