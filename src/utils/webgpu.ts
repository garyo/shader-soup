/**
 * WebGPU detection and compatibility utilities
 */

export interface WebGPUSupport {
  supported: boolean;
  adapter: GPUAdapter | null;
  error?: string;
}

/**
 * Check if WebGPU is supported in the current browser
 */
export function isWebGPUSupported(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return 'gpu' in navigator;
}

/**
 * Get detailed WebGPU support information
 */
export async function checkWebGPUSupport(): Promise<WebGPUSupport> {
  if (!isWebGPUSupported()) {
    return {
      supported: false,
      adapter: null,
      error: 'WebGPU is not supported in this browser',
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      return {
        supported: false,
        adapter: null,
        error: 'Failed to request WebGPU adapter. Your GPU may not be compatible.',
      };
    }

    return {
      supported: true,
      adapter,
    };
  } catch (error) {
    return {
      supported: false,
      adapter: null,
      error: error instanceof Error ? error.message : 'Unknown error checking WebGPU support',
    };
  }
}

/**
 * Get browser compatibility information
 */
export interface BrowserInfo {
  name: string;
  supported: boolean;
  minVersion?: string;
}

export function getBrowserInfo(): BrowserInfo {
  const ua = navigator.userAgent;

  // Chrome/Edge (Chromium)
  if (ua.includes('Chrome') || ua.includes('Edg')) {
    const match = ua.match(/(?:Chrome|Edg)\/(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;
    return {
      name: ua.includes('Edg') ? 'Edge' : 'Chrome',
      supported: version >= 113,
      minVersion: '113',
    };
  }

  // Firefox
  if (ua.includes('Firefox')) {
    const match = ua.match(/Firefox\/(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;
    return {
      name: 'Firefox',
      supported: version >= 118,
      minVersion: '118',
    };
  }

  // Safari
  if (ua.includes('Safari') && !ua.includes('Chrome')) {
    const match = ua.match(/Version\/(\d+)/);
    const version = match ? parseInt(match[1], 10) : 0;
    return {
      name: 'Safari',
      supported: version >= 18,
      minVersion: '18',
    };
  }

  return {
    name: 'Unknown',
    supported: false,
  };
}

/**
 * Get recommended browsers list
 */
export function getRecommendedBrowsers(): string[] {
  return [
    'Chrome 113 or later',
    'Edge 113 or later',
    'Firefox 118 or later',
    'Safari 18 or later',
  ];
}
