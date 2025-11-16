import { describe, it, expect, vi } from 'vitest';
import {
  isWebGPUSupported,
  checkWebGPUSupport,
  getBrowserInfo,
  getRecommendedBrowsers,
} from '@/utils/webgpu';

describe('WebGPU Utils', () => {
  describe('isWebGPUSupported', () => {
    it('should return false when navigator.gpu is not available', () => {
      const result = isWebGPUSupported();
      expect(result).toBe(false);
    });

    it('should return true when navigator.gpu is available', () => {
      const mockGpu = {};
      Object.defineProperty(navigator, 'gpu', {
        value: mockGpu,
        configurable: true,
      });

      const result = isWebGPUSupported();
      expect(result).toBe(true);

      // Cleanup
      delete (navigator as any).gpu;
    });
  });

  describe('checkWebGPUSupport', () => {
    it('should return unsupported when WebGPU is not available', async () => {
      const result = await checkWebGPUSupport();

      expect(result.supported).toBe(false);
      expect(result.adapter).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('should return adapter when WebGPU is available', async () => {
      const mockAdapter = { name: 'Mock Adapter' };
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(navigator, 'gpu', {
        value: mockGpu,
        configurable: true,
      });

      const result = await checkWebGPUSupport();

      expect(result.supported).toBe(true);
      expect(result.adapter).toBe(mockAdapter);
      expect(result.error).toBeUndefined();

      // Cleanup
      delete (navigator as any).gpu;
    });

    it('should handle requestAdapter returning null', async () => {
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(null),
      };

      Object.defineProperty(navigator, 'gpu', {
        value: mockGpu,
        configurable: true,
      });

      const result = await checkWebGPUSupport();

      expect(result.supported).toBe(false);
      expect(result.adapter).toBeNull();
      expect(result.error).toContain('Failed to request WebGPU adapter');

      // Cleanup
      delete (navigator as any).gpu;
    });
  });

  describe('getBrowserInfo', () => {
    it('should detect Chrome', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        configurable: true,
      });

      const info = getBrowserInfo();
      expect(info.name).toBe('Chrome');
      expect(info.supported).toBe(true);
      expect(info.minVersion).toBe('113');
    });

    it('should detect Edge', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        configurable: true,
      });

      const info = getBrowserInfo();
      expect(info.name).toBe('Edge');
      expect(info.supported).toBe(true);
    });

    it('should detect Firefox', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        configurable: true,
      });

      const info = getBrowserInfo();
      expect(info.name).toBe('Firefox');
      expect(info.supported).toBe(true);
    });

    it('should detect Safari', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        configurable: true,
      });

      const info = getBrowserInfo();
      expect(info.name).toBe('Safari');
      expect(info.supported).toBe(true);
    });

    it('should mark old Chrome version as unsupported', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
        configurable: true,
      });

      const info = getBrowserInfo();
      expect(info.name).toBe('Chrome');
      expect(info.supported).toBe(false);
    });
  });

  describe('getRecommendedBrowsers', () => {
    it('should return a list of recommended browsers', () => {
      const browsers = getRecommendedBrowsers();

      expect(browsers).toBeInstanceOf(Array);
      expect(browsers.length).toBeGreaterThan(0);
      expect(browsers).toContain('Chrome 113 or later');
      expect(browsers).toContain('Firefox 118 or later');
    });
  });
});
