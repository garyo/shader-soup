/**
 * Coordinate Generator - Generate normalized coordinate grids
 */

import type { Dimensions } from '@/types/core';

/**
 * Coordinate system:
 * - X: -1.0 (left) to 1.0 (right)
 * - Y: Aspect-ratio scaled, centered at 0.0
 * - Origin: Center of image (0, 0)
 */
export class CoordinateGenerator {
  /**
   * Generate normalized coordinate grid
   * @param dimensions - Output dimensions
   * @returns Float32Array with interleaved x,y coordinates
   */
  public generateGrid(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;

        // Normalize X to -1 to 1
        const normalizedX = (x / (width - 1)) * 2 - 1;

        // Normalize Y to maintain aspect ratio, centered at 0
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        coords[index] = normalizedX;
        coords[index + 1] = normalizedY;
      }
    }

    return coords;
  }

  /**
   * Normalize a single coordinate pair
   * @param x - Pixel x coordinate
   * @param y - Pixel y coordinate
   * @param dimensions - Image dimensions
   * @returns Normalized [x, y] coordinates
   */
  public normalizeCoordinates(x: number, y: number, dimensions: Dimensions): [number, number] {
    const { width, height } = dimensions;
    const aspectRatio = width / height;

    const normalizedX = (x / (width - 1)) * 2 - 1;
    const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

    return [normalizedX, normalizedY];
  }

  /**
   * Denormalize coordinates back to pixel coordinates
   * @param normalizedX - Normalized x (-1 to 1)
   * @param normalizedY - Normalized y (aspect-ratio scaled)
   * @param dimensions - Image dimensions
   * @returns Pixel [x, y] coordinates
   */
  public denormalizeCoordinates(
    normalizedX: number,
    normalizedY: number,
    dimensions: Dimensions
  ): [number, number] {
    const { width, height } = dimensions;
    const aspectRatio = width / height;

    const x = ((normalizedX + 1) / 2) * (width - 1);
    const y = ((normalizedY * aspectRatio + 1) / 2) * (height - 1);

    return [x, y];
  }

  /**
   * Get coordinate at specific pixel
   * @param x - Pixel x coordinate
   * @param y - Pixel y coordinate
   * @param coords - Coordinate grid
   * @param width - Image width
   * @returns [x, y] coordinates
   */
  public getCoordinateAt(x: number, y: number, coords: Float32Array, width: number): [number, number] {
    const index = (y * width + x) * 2;
    return [coords[index], coords[index + 1]];
  }

  /**
   * Generate polar coordinates (r, theta)
   * @param dimensions - Output dimensions
   * @returns Float32Array with interleaved r, theta coordinates
   */
  public generatePolarGrid(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;

        // Get normalized coordinates
        const normalizedX = (x / (width - 1)) * 2 - 1;
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        // Convert to polar
        const r = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        const theta = Math.atan2(normalizedY, normalizedX);

        coords[index] = r;
        coords[index + 1] = theta;
      }
    }

    return coords;
  }

  /**
   * Get the bounds of the normalized coordinate system
   * @param dimensions - Image dimensions
   * @returns Bounds { minX, maxX, minY, maxY }
   */
  public getBounds(dimensions: Dimensions): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const aspectRatio = dimensions.width / dimensions.height;

    return {
      minX: -1.0,
      maxX: 1.0,
      minY: -1.0 / aspectRatio,
      maxY: 1.0 / aspectRatio,
    };
  }

  /**
   * Create a coordinate grid with a custom mapping function
   * @param dimensions - Output dimensions
   * @param mappingFn - Function to map pixel coords to custom coords
   * @returns Float32Array with custom coordinates
   */
  public generateCustomGrid(
    dimensions: Dimensions,
    mappingFn: (x: number, y: number, width: number, height: number) => [number, number]
  ): Float32Array {
    const { width, height } = dimensions;
    const coords = new Float32Array(width * height * 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 2;
        const [mappedX, mappedY] = mappingFn(x, y, width, height);

        coords[index] = mappedX;
        coords[index + 1] = mappedY;
      }
    }

    return coords;
  }

  /**
   * Calculate distance from center for each coordinate
   * @param dimensions - Image dimensions
   * @returns Float32Array with distances
   */
  public generateDistanceField(dimensions: Dimensions): Float32Array {
    const { width, height } = dimensions;
    const distances = new Float32Array(width * height);

    const aspectRatio = width / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;

        const normalizedX = (x / (width - 1)) * 2 - 1;
        const normalizedY = ((y / (height - 1)) * 2 - 1) / aspectRatio;

        const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
        distances[index] = distance;
      }
    }

    return distances;
  }
}
