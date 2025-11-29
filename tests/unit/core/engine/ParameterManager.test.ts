import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParameterManager } from '@/core/engine/ParameterManager';
import { BufferManager } from '@/core/engine/BufferManager';

describe('ParameterManager', () => {
  let bufferManager: BufferManager;
  let parameterManager: ParameterManager;

  beforeEach(() => {
    // Mock BufferManager
    bufferManager = {
      createBufferWithData: vi.fn(),
      writeToBuffer: vi.fn(),
    } as any;

    parameterManager = new ParameterManager(bufferManager);
  });

  describe('parseParameters', () => {
    it('should parse single parameter', () => {
      const source = '// @param frequency: 0.0, 10.0, 1.0, 0.1';

      const params = parameterManager.parseParameters(source);

      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({
        name: 'frequency',
        min: 0.0,
        max: 10.0,
        default: 1.0,
        step: 0.1,
      });
    });

    it('should parse multiple parameters', () => {
      const source = `
        // @param frequency: 0.0, 10.0, 2.0, 0.1
        // @param amplitude: 0.0, 2.0, 1.0, 0.05
        // @param phase: 0.0, 6.28, 0.0, 0.1
      `;

      const params = parameterManager.parseParameters(source);

      expect(params).toHaveLength(3);
      expect(params[0].name).toBe('frequency');
      expect(params[1].name).toBe('amplitude');
      expect(params[2].name).toBe('phase');
    });

    it('should use default step if not provided', () => {
      const source = '// @param value: 0.0, 1.0, 0.5';

      const params = parameterManager.parseParameters(source);

      expect(params).toHaveLength(1);
      expect(params[0].step).toBe(0.01);
    });

    it('should handle negative values', () => {
      const source = '// @param offset: -1.0, 1.0, 0.0, 0.1';

      const params = parameterManager.parseParameters(source);

      expect(params[0].min).toBe(-1.0);
      expect(params[0].max).toBe(1.0);
    });

    it('should return empty array for no parameters', () => {
      const source = 'fn main() {}';

      const params = parameterManager.parseParameters(source);

      expect(params).toHaveLength(0);
    });

    it('should skip invalid parameters', () => {
      const source = `
        // @param valid: 0.0, 10.0, 5.0, 0.1
        // @param invalid: 10.0, 0.0, 5.0, 0.1
      `;

      const params = parameterManager.parseParameters(source);

      // Only valid parameter should be parsed (min < max)
      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('valid');
    });
  });

  describe('getParameterValues', () => {
    it('should use default values when no values provided', () => {
      const params = [
        { name: 'a', type: 'f32' as const, min: 0, max: 10, default: 5, step: 0.1 },
        { name: 'b', type: 'f32' as const, min: 0, max: 1, default: 0.5, step: 0.01 },
      ];

      const buffer = parameterManager.getParameterValues(params);
      const values = new Float32Array(buffer);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(values.length).toBe(2);
      expect(values[0]).toBe(5);
      expect(values[1]).toBe(0.5);
    });

    it('should use provided values', () => {
      const params = [
        { name: 'a', type: 'f32' as const, min: 0, max: 10, default: 5, step: 0.1 },
        { name: 'b', type: 'f32' as const, min: 0, max: 1, default: 0.5, step: 0.01 },
      ];

      const valueMap = new Map([
        ['a', 7.5],
        ['b', 0.8],
      ]);

      const buffer = parameterManager.getParameterValues(params, valueMap);
      const values = new Float32Array(buffer);

      expect(values[0]).toBeCloseTo(7.5);
      expect(values[1]).toBeCloseTo(0.8);
    });

    it('should clamp values to min/max', () => {
      const params = [{ name: 'a', type: 'f32' as const, min: 0, max: 10, default: 5, step: 0.1 }];

      const valueMap = new Map([['a', 15]]);

      const buffer = parameterManager.getParameterValues(params, valueMap);
      const values = new Float32Array(buffer);

      expect(values[0]).toBe(10);
    });
  });

  describe('generateParameterStruct', () => {
    it('should generate WGSL struct', () => {
      const params = [
        { name: 'frequency', type: 'f32' as const, min: 0, max: 10, default: 1, step: 0.1 },
        { name: 'amplitude', type: 'f32' as const, min: 0, max: 2, default: 1, step: 0.05 },
      ];

      const struct = parameterManager.generateParameterStruct(params);

      expect(struct).toContain('struct Params');
      expect(struct).toContain('frequency: f32');
      expect(struct).toContain('amplitude: f32');
    });

    it('should return empty string for no parameters', () => {
      const struct = parameterManager.generateParameterStruct([]);

      expect(struct).toBe('');
    });
  });

  describe('generateParameterDocs', () => {
    it('should generate markdown table', () => {
      const params = [
        { name: 'frequency', type: 'f32' as const, min: 0, max: 10, default: 1, step: 0.1 },
        { name: 'amplitude', type: 'f32' as const, min: 0, max: 2, default: 1, step: 0.05 },
      ];

      const docs = parameterManager.generateParameterDocs(params);

      expect(docs).toContain('| Name | Min | Max | Default | Step |');
      expect(docs).toContain('| frequency | 0 | 10 | 1 | 0.1 |');
      expect(docs).toContain('| amplitude | 0 | 2 | 1 | 0.05 |');
    });
  });

  describe('serialize and deserialize', () => {
    it('should serialize and deserialize parameters', () => {
      const params = [
        { name: 'frequency', type: 'f32' as const, min: 0, max: 10, default: 1, step: 0.1 },
        { name: 'amplitude', type: 'f32' as const, min: 0, max: 2, default: 1, step: 0.05 },
      ];

      const values = new Map([
        ['frequency', 5],
        ['amplitude', 1.5],
      ]);

      const json = parameterManager.serializeParameters(params, values);
      const deserialized = parameterManager.deserializeParameters(json);

      expect(deserialized.get('frequency')).toBe(5);
      expect(deserialized.get('amplitude')).toBe(1.5);
    });
  });
});
