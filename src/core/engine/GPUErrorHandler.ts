/**
 * GPU Error Scope Handler
 * Provides utilities for wrapping GPU operations with error scope handling
 */

/**
 * Wraps a GPU operation with error scope handling
 * Automatically pushes error scopes before the operation and checks for errors after
 *
 * @param device - The GPU device
 * @param operationName - Human-readable name for the operation (e.g., "shader execution", "post-processing")
 * @param operation - Async function to execute within the error scope
 * @returns The result of the operation
 * @throws Error if GPU validation or out-of-memory errors occur
 *
 * @example
 * const result = await withGPUErrorScope(device, "coordinate texture creation", async () => {
 *   return await coordGenerator.createCoordinateTexture(dimensions, context);
 * });
 */
export async function withGPUErrorScope<T>(
  device: GPUDevice,
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  // Push error scopes (validation and out-of-memory)
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');

  // Execute the operation
  const result = await operation();

  // Pop and check error scopes (in reverse order: out-of-memory first, then validation)
  const memError = await device.popErrorScope();
  if (memError) {
    throw new Error(`GPU out-of-memory during ${operationName}: ${memError.message}`);
  }

  const valError = await device.popErrorScope();
  if (valError) {
    throw new Error(`GPU validation error during ${operationName}: ${valError.message}`);
  }

  return result;
}

/**
 * Wraps a synchronous GPU operation with error scope handling
 * Automatically pushes error scopes before the operation and checks for errors after
 *
 * @param device - The GPU device
 * @param operationName - Human-readable name for the operation
 * @param operation - Synchronous function to execute within the error scope
 * @returns The result of the operation
 * @throws Error if GPU validation or out-of-memory errors occur
 */
export async function withGPUErrorScopeSync<T>(
  device: GPUDevice,
  operationName: string,
  operation: () => T
): Promise<T> {
  // Push error scopes (validation and out-of-memory)
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');

  // Execute the operation
  const result = operation();

  // Pop and check error scopes (in reverse order: out-of-memory first, then validation)
  const memError = await device.popErrorScope();
  if (memError) {
    throw new Error(`GPU out-of-memory during ${operationName}: ${memError.message}`);
  }

  const valError = await device.popErrorScope();
  if (valError) {
    throw new Error(`GPU validation error during ${operationName}: ${valError.message}`);
  }

  return result;
}
