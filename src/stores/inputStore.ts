/**
 * Input Store - Manage input image and settings
 */

import { createStore } from 'solid-js/store';
import type { Dimensions } from '@/types/core';

interface InputState {
  currentImage: ImageData | null;
  imageSource: File | null;
  outputDimensions: Dimensions;
  isProcessing: boolean;
}

const [state, setState] = createStore<InputState>({
  currentImage: null,
  imageSource: null,
  outputDimensions: { width: 512, height: 512 },
  isProcessing: false,
});

export const inputStore = {
  get currentImage() {
    return state.currentImage;
  },

  get imageSource() {
    return state.imageSource;
  },

  get outputDimensions() {
    return state.outputDimensions;
  },

  get isProcessing() {
    return state.isProcessing;
  },

  /**
   * Set the current image
   */
  setImage(imageData: ImageData, file: File | null = null) {
    setState('currentImage', imageData);
    setState('imageSource', file);
  },

  /**
   * Clear the current image
   */
  clearImage() {
    setState('currentImage', null);
    setState('imageSource', null);
  },

  /**
   * Set output dimensions
   */
  setDimensions(dimensions: Dimensions) {
    setState('outputDimensions', dimensions);
  },

  /**
   * Set processing state
   */
  setProcessing(processing: boolean) {
    setState('isProcessing', processing);
  },
};
