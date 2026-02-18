/**
 * Shader Store - Manage shaders and their parameters
 */

import { createStore } from 'solid-js/store';
import type { ShaderDefinition, ShaderParameter } from '@/types/core';

const STORAGE_KEY = 'shader-soup-promoted-shaders';

interface StoredShader {
  shader: ShaderDefinition;
  parameterValues?: Record<string, number>;
  iterationValue?: number;
  globalParameters?: GlobalParameters;
}

export interface GlobalParameters {
  gamma: number;      // 0.1 to 10, default 1 (higher brightens midtones)
  contrast: number;   // -1 to 1, default 0
  zoom: number;       // 0.1 to 10, default 1
  panX: number;       // -2 to 2, default 0
  panY: number;       // -2 to 2, default 0
}

export const defaultGlobalParameters: GlobalParameters = {
  gamma: 1,
  contrast: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
};

interface ShaderState {
  shaders: Map<string, ShaderDefinition>;
  activeShaders: Set<string>;
  parameterValues: Map<string, Map<string, number>>; // shaderId -> paramName -> value
  iterationValues: Map<string, number>; // shaderId -> iteration count
  globalParameters: Map<string, Map<string, number>>; // shaderId -> paramName -> value (changed to nested Map for reactivity)
  selectedShaderId: string | null;
  promotedShaderIds: Set<string>; // Track which shaders are promoted (saved to localStorage)
  selectedForMashup: Set<string>; // Track shaders selected for mashup
}

const [state, setState] = createStore<ShaderState>({
  shaders: new Map(),
  activeShaders: new Set(),
  parameterValues: new Map(),
  iterationValues: new Map(),
  globalParameters: new Map(),
  selectedShaderId: null,
  promotedShaderIds: new Set(),
  selectedForMashup: new Set(),
});

// Helper functions for localStorage
function savePromotedShadersToStorage() {
  try {
    const promotedShaders = Array.from(state.shaders.values()).filter((shader) =>
      state.promotedShaderIds.has(shader.id)
    );

    // Create StoredShader objects with all associated data
    const storedShaders: StoredShader[] = promotedShaders.map((shader) => {
      const stored: StoredShader = {
        shader: {
          ...shader,
          createdAt: shader.createdAt.toISOString() as any,
          modifiedAt: shader.modifiedAt.toISOString() as any,
        },
      };

      // Add parameter values if they exist
      const params = state.parameterValues.get(shader.id);
      if (params && params.size > 0) {
        stored.parameterValues = Object.fromEntries(params);
      }

      // Add iteration value if it exists
      const iterations = state.iterationValues.get(shader.id);
      if (iterations !== undefined) {
        stored.iterationValue = iterations;
      }

      // Add global parameters if they exist
      const globalParams = state.globalParameters.get(shader.id);
      if (globalParams) {
        stored.globalParameters = Object.fromEntries(globalParams) as any;
      }

      return stored;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedShaders));
  } catch (error) {
    console.error('Failed to save promoted shaders to localStorage:', error);
  }
}

function loadPromotedShadersFromStorage(): StoredShader[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);

    return parsed.map((stored: any) => ({
      shader: {
        ...stored.shader,
        createdAt: new Date(stored.shader.createdAt),
        modifiedAt: new Date(stored.shader.modifiedAt),
      },
      parameterValues: stored.parameterValues,
      iterationValue: stored.iterationValue,
      globalParameters: stored.globalParameters,
    }));
  } catch (error) {
    console.error('Failed to load promoted shaders from localStorage:', error);
    return [];
  }
}

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

    // Initialize global parameters with defaults
    setState('globalParameters', (params) => {
      const newParams = new Map(params);
      const globalParamMap = new Map<string, number>();
      globalParamMap.set('gamma', defaultGlobalParameters.gamma);
      globalParamMap.set('contrast', defaultGlobalParameters.contrast);
      globalParamMap.set('zoom', defaultGlobalParameters.zoom);
      globalParamMap.set('panX', defaultGlobalParameters.panX);
      globalParamMap.set('panY', defaultGlobalParameters.panY);
      newParams.set(shader.id, globalParamMap);
      return newParams;
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

    setState('iterationValues', (values) => {
      const newValues = new Map(values);
      newValues.delete(id);
      return newValues;
    });

    setState('globalParameters', (params) => {
      const newParams = new Map(params);
      newParams.delete(id);
      return newParams;
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

    // Save to localStorage if this is a promoted shader
    if (state.promotedShaderIds.has(id)) {
      savePromotedShadersToStorage();
    }
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

    // Save to localStorage if this is a promoted shader
    if (state.promotedShaderIds.has(shaderId)) {
      savePromotedShadersToStorage();
    }
  },

  /**
   * Get iteration value for a shader
   */
  getIterationValue(shaderId: string): number | undefined {
    return state.iterationValues.get(shaderId);
  },

  /**
   * Update iteration value for a shader
   */
  updateIterationValue(shaderId: string, value: number) {
    setState('iterationValues', (values) => {
      const newValues = new Map(values);
      newValues.set(shaderId, value);
      return newValues;
    });

    // Save to localStorage if this is a promoted shader
    if (state.promotedShaderIds.has(shaderId)) {
      savePromotedShadersToStorage();
    }
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
    const active = Array.from(state.shaders.values()).filter((shader) =>
      state.activeShaders.has(shader.id)
    );

    // Examples (non-promoted) first in original order, then generated (promoted) by creation time
    const examples = active.filter(s => !state.promotedShaderIds.has(s.id));
    const generated = active.filter(s => state.promotedShaderIds.has(s.id));
    generated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return [...examples, ...generated];
  },

  /**
   * Clear all shaders
   */
  clear() {
    setState('shaders', new Map());
    setState('activeShaders', new Set());
    setState('parameterValues', new Map());
    setState('selectedShaderId', null);
    setState('promotedShaderIds', new Set());
  },

  /**
   * Clear only non-promoted (example) shaders
   */
  clearExampleShaders() {
    const shadersToRemove: string[] = [];

    // Find all non-promoted shaders
    for (const [id, _shader] of state.shaders) {
      if (!state.promotedShaderIds.has(id)) {
        shadersToRemove.push(id);
      }
    }

    // Remove each non-promoted shader
    for (const id of shadersToRemove) {
      this.removeShader(id);
    }
  },

  /**
   * Add a promoted shader (marks it for localStorage persistence)
   */
  addPromotedShader(shader: ShaderDefinition) {
    // Add shader using normal method
    this.addShader(shader);

    // Mark as promoted
    setState('promotedShaderIds', (promoted) => {
      const newPromoted = new Set(promoted);
      newPromoted.add(shader.id);
      return newPromoted;
    });

    // Save to localStorage
    savePromotedShadersToStorage();
  },

  /**
   * Load promoted shaders from localStorage
   */
  loadPromotedShaders() {
    const storedShaders = loadPromotedShadersFromStorage();

    for (const stored of storedShaders) {
      const { shader, parameterValues, iterationValue, globalParameters } = stored;

      // Add shader
      this.addShader(shader);

      // Mark as promoted
      setState('promotedShaderIds', (promoted) => {
        const newPromoted = new Set(promoted);
        newPromoted.add(shader.id);
        return newPromoted;
      });

      // Restore parameter values if they exist
      if (parameterValues) {
        const paramMap = new Map(Object.entries(parameterValues));
        setState('parameterValues', (values) => {
          const newValues = new Map(values);
          newValues.set(shader.id, paramMap);
          return newValues;
        });
      }

      // Restore iteration value if it exists
      if (iterationValue !== undefined) {
        setState('iterationValues', (values) => {
          const newValues = new Map(values);
          newValues.set(shader.id, iterationValue);
          return newValues;
        });
      }

      // Restore global parameters if they exist
      if (globalParameters) {
        setState('globalParameters', (params) => {
          const newParams = new Map(params);
          const globalParamMap = new Map(Object.entries(globalParameters));
          newParams.set(shader.id, globalParamMap);
          return newParams;
        });
      }
    }

    return storedShaders.length;
  },

  /**
   * Remove a promoted shader and update localStorage
   */
  removePromotedShader(id: string) {
    this.removeShader(id);

    setState('promotedShaderIds', (promoted) => {
      const newPromoted = new Set(promoted);
      newPromoted.delete(id);
      return newPromoted;
    });

    savePromotedShadersToStorage();
  },

  /**
   * Toggle shader selection for mashup
   */
  toggleMashupSelection(id: string) {
    setState('selectedForMashup', (selected) => {
      const newSelected = new Set(selected);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  },

  /**
   * Check if shader is selected for mashup
   */
  isMashupSelected(id: string): boolean {
    return state.selectedForMashup.has(id);
  },

  /**
   * Get all selected shaders for mashup
   */
  getMashupSelected(): ShaderDefinition[] {
    return Array.from(state.selectedForMashup)
      .map((id) => state.shaders.get(id))
      .filter((shader): shader is ShaderDefinition => shader !== undefined);
  },

  /**
   * Clear mashup selection
   */
  clearMashupSelection() {
    setState('selectedForMashup', new Set());
  },

  /**
   * Get count of selected shaders
   */
  getMashupSelectionCount(): number {
    return state.selectedForMashup.size;
  },

  /**
   * Check if shader is promoted (saved to localStorage)
   */
  isPromoted(id: string): boolean {
    return state.promotedShaderIds.has(id);
  },

  /**
   * Get global parameters for a shader
   */
  getGlobalParameters(shaderId: string): GlobalParameters {
    const paramMap = state.globalParameters.get(shaderId);
    if (paramMap) {
      return {
        gamma: paramMap.get('gamma') ?? defaultGlobalParameters.gamma,
        contrast: paramMap.get('contrast') ?? defaultGlobalParameters.contrast,
        zoom: paramMap.get('zoom') ?? defaultGlobalParameters.zoom,
        panX: paramMap.get('panX') ?? defaultGlobalParameters.panX,
        panY: paramMap.get('panY') ?? defaultGlobalParameters.panY,
      };
    }
    return { ...defaultGlobalParameters };
  },

  /**
   * Get a single global parameter value (reactive)
   */
  getGlobalParameter(shaderId: string, paramName: keyof GlobalParameters): number {
    const params = state.globalParameters.get(shaderId);
    return params ? (params.get(paramName) ?? defaultGlobalParameters[paramName]) : defaultGlobalParameters[paramName];
  },

  /**
   * Update a single global parameter
   */
  updateGlobalParameter(
    shaderId: string,
    paramName: keyof GlobalParameters,
    value: number
  ) {
    setState('globalParameters', (params) => {
      const newParams = new Map(params);
      const current = newParams.get(shaderId);
      if (current) {
        const newParamMap = new Map(current);
        newParamMap.set(paramName, value);
        newParams.set(shaderId, newParamMap);
      }
      return newParams;
    });

    // Save to localStorage if this is a promoted shader
    if (state.promotedShaderIds.has(shaderId)) {
      savePromotedShadersToStorage();
    }
  },

  /**
   * Reset global parameters to defaults
   */
  resetGlobalParameters(shaderId: string) {
    setState('globalParameters', (params) => {
      const newParams = new Map(params);
      const globalParamMap = new Map<string, number>();
      globalParamMap.set('gamma', defaultGlobalParameters.gamma);
      globalParamMap.set('contrast', defaultGlobalParameters.contrast);
      globalParamMap.set('zoom', defaultGlobalParameters.zoom);
      globalParamMap.set('panX', defaultGlobalParameters.panX);
      globalParamMap.set('panY', defaultGlobalParameters.panY);
      newParams.set(shaderId, globalParamMap);
      return newParams;
    });

    // Save to localStorage if this is a promoted shader
    if (state.promotedShaderIds.has(shaderId)) {
      savePromotedShadersToStorage();
    }
  },
};
