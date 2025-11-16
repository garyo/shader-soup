/**
 * Shader Store - Manage shaders and their parameters
 */

import { createStore } from 'solid-js/store';
import type { ShaderDefinition, ShaderParameter } from '@/types/core';

interface ShaderState {
  shaders: Map<string, ShaderDefinition>;
  activeShaders: Set<string>;
  parameterValues: Map<string, Map<string, number>>; // shaderId -> paramName -> value
  selectedShaderId: string | null;
}

const [state, setState] = createStore<ShaderState>({
  shaders: new Map(),
  activeShaders: new Set(),
  parameterValues: new Map(),
  selectedShaderId: null,
});

export const shaderStore = {
  get shaders() {
    return state.shaders;
  },

  get activeShaders() {
    return state.activeShaders;
  },

  get parameterValues() {
    return state.parameterValues;
  },

  get selectedShaderId() {
    return state.selectedShaderId;
  },

  /**
   * Add a shader to the store
   */
  addShader(shader: ShaderDefinition) {
    setState('shaders', (shaders) => {
      const newShaders = new Map(shaders);
      newShaders.set(shader.id, shader);
      return newShaders;
    });

    // Initialize parameter values with defaults
    const paramValues = new Map<string, number>();
    for (const param of shader.parameters) {
      paramValues.set(param.name, param.default);
    }

    setState('parameterValues', (values) => {
      const newValues = new Map(values);
      newValues.set(shader.id, paramValues);
      return newValues;
    });

    // Activate shader by default
    setState('activeShaders', (active) => {
      const newActive = new Set(active);
      newActive.add(shader.id);
      return newActive;
    });
  },

  /**
   * Remove a shader from the store
   */
  removeShader(id: string) {
    setState('shaders', (shaders) => {
      const newShaders = new Map(shaders);
      newShaders.delete(id);
      return newShaders;
    });

    setState('activeShaders', (active) => {
      const newActive = new Set(active);
      newActive.delete(id);
      return newActive;
    });

    setState('parameterValues', (values) => {
      const newValues = new Map(values);
      newValues.delete(id);
      return newValues;
    });

    if (state.selectedShaderId === id) {
      setState('selectedShaderId', null);
    }
  },

  /**
   * Update shader source code
   */
  updateShader(id: string, source: string, parameters: ShaderParameter[]) {
    setState('shaders', (shaders) => {
      const newShaders = new Map(shaders);
      const shader = newShaders.get(id);
      if (shader) {
        newShaders.set(id, {
          ...shader,
          source,
          parameters,
          modifiedAt: new Date(),
        });
      }
      return newShaders;
    });

    // Update parameter values, keeping existing values where possible
    const existingValues = state.parameterValues.get(id) || new Map();
    const newParamValues = new Map<string, number>();

    for (const param of parameters) {
      const existingValue = existingValues.get(param.name);
      newParamValues.set(param.name, existingValue ?? param.default);
    }

    setState('parameterValues', (values) => {
      const newValues = new Map(values);
      newValues.set(id, newParamValues);
      return newValues;
    });
  },

  /**
   * Update a parameter value
   */
  updateParameter(shaderId: string, paramName: string, value: number) {
    setState('parameterValues', (values) => {
      const newValues = new Map(values);
      const shaderParams = newValues.get(shaderId);

      if (shaderParams) {
        const newShaderParams = new Map(shaderParams);
        newShaderParams.set(paramName, value);
        newValues.set(shaderId, newShaderParams);
      }

      return newValues;
    });
  },

  /**
   * Toggle shader active state
   */
  toggleShader(id: string) {
    setState('activeShaders', (active) => {
      const newActive = new Set(active);
      if (newActive.has(id)) {
        newActive.delete(id);
      } else {
        newActive.add(id);
      }
      return newActive;
    });
  },

  /**
   * Select a shader
   */
  selectShader(id: string | null) {
    setState('selectedShaderId', id);
  },

  /**
   * Get shader by ID
   */
  getShader(id: string): ShaderDefinition | undefined {
    return state.shaders.get(id);
  },

  /**
   * Get parameter values for a shader
   */
  getParameterValues(shaderId: string): Map<string, number> | undefined {
    return state.parameterValues.get(shaderId);
  },

  /**
   * Get all active shaders
   */
  getActiveShaders(): ShaderDefinition[] {
    return Array.from(state.shaders.values()).filter((shader) =>
      state.activeShaders.has(shader.id)
    );
  },

  /**
   * Clear all shaders
   */
  clear() {
    setState('shaders', new Map());
    setState('activeShaders', new Set());
    setState('parameterValues', new Map());
    setState('selectedShaderId', null);
  },
};
