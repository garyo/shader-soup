# Shader Soup

A WebGPU-based shader evolution platform for generative image processing and creation.

## Overview

Shader Soup is a web application that enables the execution and visualization of WebGPU compute shaders for image generation and processing. The application provides a framework for running arbitrary compute shaders with inputs of optional 2D images and normalized XY coordinates, displaying results from multiple shaders simultaneously.

### Current Features

- **WebGPU Compute Shader Execution**: Run custom WGSL (WebGPU Shading Language) shaders
- **Flexible Input System**: Support for optional 2D image inputs and normalized coordinate spaces
- **Multi-Shader Visualization**: Display results from N shaders simultaneously
- **Real-time Processing**: GPU-accelerated image generation and processing
- **Shader Parameters**: Define adjustable parameters (uniforms) with interactive sliders for real-time control

### Planned Features (Future)

- **LLM-Driven Evolution**: Automated shader mutation and evolution using language models
- **Fitness Selection**: User-driven selection mechanism for preferred outputs
- **Genetic Algorithm**: Evolve shaders based on user preferences

## Tech Stack

- **TypeScript**: Type-safe development
- **Bun**: Fast runtime and package manager
- **Astro.js**: Modern web framework with excellent performance
- **SolidJS**: Reactive state management and UI components
- **WebGPU**: GPU-accelerated compute shaders (WGSL)
- **Vitest**: Testing framework

## Prerequisites

- **Bun**: v1.0 or higher
- **Modern Browser**: Chrome/Edge 113+, Firefox 118+, or Safari 18+ with WebGPU support
- **GPU**: Any GPU with WebGPU support

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd shader-soup

# Install dependencies
bun install
```

## Development

```bash
# Start development server
bun run dev

# Run tests
bun test

# Run tests in watch mode
bun test:watch

# Type check
bun run typecheck

# Build for production
bun run build

# Preview production build
bun run preview
```

## Project Structure

```
shader-soup/
├── src/
│   ├── components/         # SolidJS UI components
│   ├── core/              # Core WebGPU and shader engine
│   ├── stores/            # SolidJS state management
│   ├── shaders/           # WGSL shader examples and templates
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── pages/             # Astro pages
├── tests/                 # Test files
├── public/                # Static assets
└── docs/                  # Additional documentation
```

## Usage

### Basic Shader Execution

The application provides a shader execution framework that:

1. Compiles WGSL compute shaders
2. Allocates GPU buffers for inputs (images, coordinates)
3. Executes the shader on the GPU
4. Retrieves and displays the results

### Coordinate System

- **X axis**: -1.0 (left) to 1.0 (right)
- **Y axis**: -1.0 (bottom) to 1.0 (top), scaled to maintain aspect ratio, centered at 0.0
- **Origin**: Center of the image (0, 0)

**Note**: All rendered outputs (canvas display, preview popups, and downloaded images) use consistent Y-axis orientation with Y+ pointing upward (mathematical convention).

### Writing Shaders with Parameters

Shaders can define adjustable parameters using comment annotations. These automatically generate UI sliders for real-time control.

**Example: Sine Wave Pattern**

```wgsl
// @param frequency: 0.0, 10.0, 2.0, 0.1
// @param amplitude: 0.0, 2.0, 1.0, 0.05
// @param phase: 0.0, 6.28, 0.0, 0.1

struct Params {
  frequency: f32,
  amplitude: f32,
  phase: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.y * 512u + id.x;
  let coord = coords[index];

  // Generate sine wave pattern
  let wave = sin(coord.x * params.frequency + params.phase) * params.amplitude;
  let brightness = (wave + 1.0) * 0.5;

  output[index] = vec4<f32>(brightness, brightness, brightness, 1.0);
}
```

**Parameter Format**: `// @param name: min, max, default, step`

- **name**: Parameter identifier (must match struct field)
- **min**: Minimum value
- **max**: Maximum value
- **default**: Initial value
- **step**: Slider increment (optional, defaults to 0.01)

Each parameter creates an interactive slider in the UI, allowing real-time adjustment and instant visual feedback.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture and design decisions
- [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) - Phased implementation approach

## Browser Compatibility

WebGPU support is required. Check compatibility at [caniuse.com/webgpu](https://caniuse.com/webgpu).

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- All tests pass (`bun test`)
- Code follows TypeScript best practices
- New features include comprehensive tests
- Documentation is updated accordingly
