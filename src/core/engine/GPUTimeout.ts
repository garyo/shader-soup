/**
 * GPU Timeout utility — drop-in replacement for device.queue.onSubmittedWorkDone()
 * that won't hang forever if the GPU device is lost or stuck.
 */

export function gpuTimeout(device: GPUDevice, ms = 5000): Promise<void> {
  return Promise.race([
    device.queue.onSubmittedWorkDone(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn(`[GPUTimeout] onSubmittedWorkDone did not resolve within ${ms}ms — continuing`);
        resolve();
      }, ms)
    ),
  ]);
}
