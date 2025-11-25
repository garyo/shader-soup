/**
 * General utility helpers for the application
 */

/**
 * Extracts an error message from an unknown error value
 * Handles Error objects, strings, and unknown types consistently
 *
 * @param error - The error value (can be Error, string, or anything)
 * @param defaultMessage - Default message if error is not recognizable (default: 'Unknown error')
 * @returns A string error message
 *
 * @example
 * try {
 *   throw new Error('Something went wrong');
 * } catch (err) {
 *   const message = getErrorMessage(err);
 *   console.error(message); // "Something went wrong"
 * }
 */
export function getErrorMessage(error: unknown, defaultMessage = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return defaultMessage;
}

/**
 * Calculates supersampled dimensions for antialiasing
 *
 * @param baseDimensions - Base dimensions to supersample
 * @param factor - Supersample factor (default: 3)
 * @returns Supersampled dimensions
 *
 * @example
 * const superDims = calculateSupersampledDimensions({width: 512, height: 512}, 3);
 * // Returns {width: 1536, height: 1536}
 */
export function calculateSupersampledDimensions(
  baseDimensions: { width: number; height: number },
  factor: number = 3
): { width: number; height: number } {
  return {
    width: baseDimensions.width * factor,
    height: baseDimensions.height * factor,
  };
}
