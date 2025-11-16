import '@testing-library/jest-dom';

// Mock WebGPU API for tests
// Since WebGPU is not available in jsdom, we'll mock it
globalThis.navigator = globalThis.navigator || {};
(globalThis.navigator as any).gpu = {
  requestAdapter: async () => null,
};

// Mock for tests that need WebGPU
export const mockWebGPUAdapter = () => {
  return {
    requestDevice: async () => ({
      createShaderModule: () => ({}),
      createBuffer: () => ({}),
      createBindGroup: () => ({}),
      createBindGroupLayout: () => ({}),
      createComputePipeline: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline: () => {},
          setBindGroup: () => {},
          dispatchWorkgroups: () => {},
          end: () => {},
        }),
        finish: () => ({}),
        copyBufferToBuffer: () => {},
      }),
      queue: {
        submit: () => {},
        writeBuffer: () => {},
      },
    }),
  };
};
