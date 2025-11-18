/**
 * Evolution Store - Track shader evolution progress and results
 */

import { createStore } from 'solid-js/store';
import type { ShaderDefinition } from '@/types/core';

export type EvolutionStatus = 'mutating' | 'debugging' | 'naming' | 'complete' | 'failed' | 'cancelled';

export interface EvolutionProgress {
  shaderId: string;
  shaderName: string;
  status: EvolutionStatus;
  currentChild: number;
  totalChildren: number;
  debugAttempt: number;
  maxDebugAttempts: number;
  lastError?: string;
  startTime: Date;
  temperature: number;
}

interface EvolutionState {
  // Active evolutions in progress
  activeEvolutions: Map<string, EvolutionProgress>;
  // Completed children: shaderId -> list of evolved children
  children: Map<string, ShaderDefinition[]>;
  // Mashup results (separate from regular evolution)
  mashupResults: ShaderDefinition[];
  mashupParentNames: string[]; // Names of parent shaders for current mashup
  // Evolution settings
  defaultChildrenCount: number;
  defaultTemperature: number;
}

const [state, setState] = createStore<EvolutionState>({
  activeEvolutions: new Map(),
  children: new Map(),
  mashupResults: [],
  mashupParentNames: [],
  defaultChildrenCount: 10,
  defaultTemperature: 0.5,
});

export const evolutionStore = {
  // Getters
  get activeEvolutions() {
    return state.activeEvolutions;
  },

  get children() {
    return state.children;
  },

  getProgress(shaderId: string): EvolutionProgress | undefined {
    return state.activeEvolutions.get(shaderId);
  },

  getChildren(shaderId: string): ShaderDefinition[] {
    return state.children.get(shaderId) || [];
  },

  isEvolving(shaderId: string): boolean {
    return state.activeEvolutions.has(shaderId);
  },

  // Actions
  startEvolution(
    shaderId: string,
    shaderName: string,
    childrenCount: number = state.defaultChildrenCount,
    temperature: number = state.defaultTemperature
  ): void {
    const progress: EvolutionProgress = {
      shaderId,
      shaderName,
      status: 'mutating',
      currentChild: 0,
      totalChildren: childrenCount,
      debugAttempt: 0,
      maxDebugAttempts: 5,
      startTime: new Date(),
      temperature,
    };

    setState('activeEvolutions', (evolutions) => {
      const newMap = new Map(evolutions);
      newMap.set(shaderId, progress);
      return newMap;
    });

    // Initialize empty children array
    setState('children', (children) => {
      const newMap = new Map(children);
      newMap.set(shaderId, []);
      return newMap;
    });
  },

  updateProgress(
    shaderId: string,
    updates: Partial<Omit<EvolutionProgress, 'shaderId' | 'shaderName' | 'startTime'>>
  ): void {
    setState('activeEvolutions', (evolutions) => {
      const newMap = new Map(evolutions);
      const current = newMap.get(shaderId);
      if (current) {
        newMap.set(shaderId, { ...current, ...updates });
      }
      return newMap;
    });
  },

  addChild(shaderId: string, child: ShaderDefinition): void {
    setState('children', (children) => {
      const newMap = new Map(children);
      const existing = newMap.get(shaderId) || [];
      newMap.set(shaderId, [...existing, child]);
      return newMap;
    });
  },

  completeEvolution(shaderId: string): void {
    setState('activeEvolutions', (evolutions) => {
      const newMap = new Map(evolutions);
      const current = newMap.get(shaderId);
      if (current) {
        newMap.set(shaderId, { ...current, status: 'complete' });
      }
      return newMap;
    });

    // Remove from active after a delay to show completion
    setTimeout(() => {
      setState('activeEvolutions', (evolutions) => {
        const newMap = new Map(evolutions);
        newMap.delete(shaderId);
        return newMap;
      });
    }, 2000);
  },

  failEvolution(shaderId: string, error: string): void {
    setState('activeEvolutions', (evolutions) => {
      const newMap = new Map(evolutions);
      const current = newMap.get(shaderId);
      if (current) {
        newMap.set(shaderId, { ...current, status: 'failed', lastError: error });
      }
      return newMap;
    });
  },

  cancelEvolution(shaderId: string): void {
    setState('activeEvolutions', (evolutions) => {
      const newMap = new Map(evolutions);
      newMap.delete(shaderId);
      return newMap;
    });
  },

  clearChildren(shaderId: string): void {
    setState('children', (children) => {
      const newMap = new Map(children);
      newMap.delete(shaderId);
      return newMap;
    });
  },

  // Settings
  setDefaultChildrenCount(count: number): void {
    setState('defaultChildrenCount', count);
  },

  setDefaultTemperature(temp: number): void {
    setState('defaultTemperature', temp);
  },

  // Mashup methods
  getMashupResults(): ShaderDefinition[] {
    return state.mashupResults;
  },

  getMashupParentNames(): string[] {
    return state.mashupParentNames;
  },

  setMashupResults(results: ShaderDefinition[], parentNames: string[]): void {
    setState('mashupResults', results);
    setState('mashupParentNames', parentNames);
  },

  clearMashupResults(): void {
    setState('mashupResults', []);
    setState('mashupParentNames', []);
  },

  addMashupResult(result: ShaderDefinition): void {
    setState('mashupResults', (results) => [...results, result]);
  },
};
