import { describe, it, expect } from 'vitest';
import { CoordinateGenerator } from '@/core/input/CoordinateGenerator';

describe('CoordinateGenerator', () => {
  const generator = new CoordinateGenerator();

  describe('generateGrid', () => {
    it('should generate correct number of coordinates', () => {
      const dimensions = { width: 4, height: 4 };
      const coords = generator.generateGrid(dimensions);

      // 4x4 grid with 2 values (x, y) per pixel
      expect(coords.length).toBe(4 * 4 * 2);
    });

    it('should generate normalized coordinates', () => {
      const dimensions = { width: 3, height: 3 };
      const coords = generator.generateGrid(dimensions);

      // First pixel (0, 0) should be top-left
      expect(coords[0]).toBeCloseTo(-1.0); // x
      expect(coords[1]).toBeCloseTo(-1.0); // y (aspect ratio 1:1)

      // Center pixel should be around (0, 0)
      const centerIndex = (1 * 3 + 1) * 2;
      expect(coords[centerIndex]).toBeCloseTo(0.0);
      expect(coords[centerIndex + 1]).toBeCloseTo(0.0);

      // Last pixel should be bottom-right
      const lastIndex = (2 * 3 + 2) * 2;
      expect(coords[lastIndex]).toBeCloseTo(1.0);
      expect(coords[lastIndex + 1]).toBeCloseTo(1.0);
    });

    it('should handle aspect ratio correctly', () => {
      const dimensions = { width: 100, height: 50 };
      generator.generateGrid(dimensions);

      // Width should always be -1 to 1
      // Height should be scaled by aspect ratio
      const bounds = generator.getBounds(dimensions);

      expect(bounds.minX).toBe(-1.0);
      expect(bounds.maxX).toBe(1.0);
      expect(bounds.minY).toBeCloseTo(-0.5);
      expect(bounds.maxY).toBeCloseTo(0.5);
    });
  });

  describe('normalizeCoordinates', () => {
    it('should normalize pixel coordinates correctly', () => {
      const dimensions = { width: 100, height: 100 };

      const [x1, y1] = generator.normalizeCoordinates(0, 0, dimensions);
      expect(x1).toBeCloseTo(-1.0);
      expect(y1).toBeCloseTo(-1.0);

      const [x2, y2] = generator.normalizeCoordinates(99, 99, dimensions);
      expect(x2).toBeCloseTo(1.0);
      expect(y2).toBeCloseTo(1.0);

      const [x3, y3] = generator.normalizeCoordinates(49, 49, dimensions);
      expect(x3).toBeCloseTo(0.0, 1);
      expect(y3).toBeCloseTo(0.0, 1);
    });
  });

  describe('denormalizeCoordinates', () => {
    it('should convert normalized coords back to pixel coords', () => {
      const dimensions = { width: 100, height: 100 };

      const [x1, y1] = generator.denormalizeCoordinates(-1.0, -1.0, dimensions);
      expect(x1).toBeCloseTo(0);
      expect(y1).toBeCloseTo(0);

      const [x2, y2] = generator.denormalizeCoordinates(1.0, 1.0, dimensions);
      expect(x2).toBeCloseTo(99);
      expect(y2).toBeCloseTo(99);

      const [x3, y3] = generator.denormalizeCoordinates(0.0, 0.0, dimensions);
      expect(x3).toBeCloseTo(49.5);
      expect(y3).toBeCloseTo(49.5);
    });
  });

  describe('generatePolarGrid', () => {
    it('should generate polar coordinates', () => {
      const dimensions = { width: 4, height: 4 };
      const coords = generator.generatePolarGrid(dimensions);

      expect(coords.length).toBe(4 * 4 * 2);

      // Check that all values are valid
      for (let i = 0; i < coords.length; i += 2) {
        const r = coords[i];
        const theta = coords[i + 1];

        expect(r).toBeGreaterThanOrEqual(0);
        expect(theta).toBeGreaterThanOrEqual(-Math.PI);
        expect(theta).toBeLessThanOrEqual(Math.PI);
      }

      // First pixel should have some distance from center
      expect(coords[0]).toBeGreaterThan(0);
    });
  });

  describe('getBounds', () => {
    it('should return correct bounds for square image', () => {
      const dimensions = { width: 100, height: 100 };
      const bounds = generator.getBounds(dimensions);

      expect(bounds.minX).toBe(-1.0);
      expect(bounds.maxX).toBe(1.0);
      expect(bounds.minY).toBe(-1.0);
      expect(bounds.maxY).toBe(1.0);
    });

    it('should return correct bounds for wide image', () => {
      const dimensions = { width: 200, height: 100 };
      const bounds = generator.getBounds(dimensions);

      expect(bounds.minX).toBe(-1.0);
      expect(bounds.maxX).toBe(1.0);
      expect(bounds.minY).toBeCloseTo(-0.5);
      expect(bounds.maxY).toBeCloseTo(0.5);
    });
  });

  describe('generateDistanceField', () => {
    it('should generate distance field', () => {
      const dimensions = { width: 4, height: 4 };
      const distances = generator.generateDistanceField(dimensions);

      expect(distances.length).toBe(4 * 4);

      // Center should have minimum distance
      const centerIndex = 1 * 4 + 1;
      const centerDist = distances[centerIndex];

      expect(centerDist).toBeGreaterThanOrEqual(0);

      // All distances should be non-negative
      for (let i = 0; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
