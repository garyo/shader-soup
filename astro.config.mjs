import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';

// https://astro.build/config
export default defineConfig({
  integrations: [solid()],
  vite: {
    optimizeDeps: {
      exclude: ['@webgpu/types'],
    },
    assetsInclude: ['**/*.wgsl'],
    envPrefix: 'VITE_', // Explicitly enable VITE_ prefixed env vars
  },
});
