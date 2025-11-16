import { createSignal, onMount, Show } from 'solid-js';
import {
  checkWebGPUSupport,
  getBrowserInfo,
  getRecommendedBrowsers,
  type WebGPUSupport,
} from '@/utils/webgpu';

export default function WebGPUCheck() {
  const [support, setSupport] = createSignal<WebGPUSupport | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const result = await checkWebGPUSupport();
    setSupport(result);
    setLoading(false);
  });

  const browserInfo = getBrowserInfo();
  const recommendedBrowsers = getRecommendedBrowsers();

  return (
    <Show when={!loading()} fallback={<div>Checking WebGPU support...</div>}>
      <Show when={!support()?.supported}>
        <div class="webgpu-warning">
          <h2>WebGPU Not Supported</h2>
          <p class="error-message">{support()?.error || 'WebGPU is not available'}</p>

          <Show when={!browserInfo.supported}>
            <div class="browser-info">
              <p>
                Your browser ({browserInfo.name}) does not support WebGPU or needs to be updated.
              </p>
              <p>Minimum required version: {browserInfo.minVersion}</p>
            </div>
          </Show>

          <div class="recommendations">
            <h3>Recommended Browsers:</h3>
            <ul>
              {recommendedBrowsers.map((browser) => (
                <li>{browser}</li>
              ))}
            </ul>
          </div>

          <div class="help">
            <p>
              <strong>Need help?</strong>
            </p>
            <p>
              Check browser compatibility at{' '}
              <a href="https://caniuse.com/webgpu" target="_blank" rel="noopener noreferrer">
                caniuse.com/webgpu
              </a>
            </p>
          </div>
        </div>
      </Show>

      <Show when={support()?.supported}>
        <div class="webgpu-success">
          <p>✓ WebGPU is supported and ready!</p>
        </div>
      </Show>
    </Show>
  );
}
