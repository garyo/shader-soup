# Shader Soup

Can AIs be creative? An investigation using AI-based WebGPU shader generation

## Overview

Shader Soup is an investigation into AI creativity. I wanted to give it the bare minimum of tools and see what it could come up with on its own, using prompts that push it to be creative and think out of the box.

It starts with this prompt: "You are a highly creative WebGPU shader developer. Your goal is to create something new, unique and beautiful by evolving the input shaders, adding your own ideas, refactoring and modifying according to the temperature. Think about symmetry, color, texture, light and shadow."

The framework gives each shader the current time, a set of `uv` (x/y) coordinates, current parameter values, and the previous frame (a texture) as inputs. The evolver produces new shaders, along with parameter definitions and default values and names. There's a small set of built-in primitives (see below). Anything else, the agent can invent for itself — which it often does. 

The UI lets you evolve "children" from any shader, or mash-up multiple shaders to produce offspring. Mousing over a shader runs it in real time. Pressing F enters full-screen mode. You can also adjust param values and global params like pan/zoom and color (gamma and contrast). You can also hand-edit the generated source code for any shader in the syntax-checking editor. (Surprisingly (to me anyway), the LLM often comments its code!) You can download high-res still images, and export the shaders for use elsewhere. (Downloading movies is planned, but not available yet.)

To use this app, you need an Anthropic API key, which you can get at https://console.anthropic.com/settings/keys. In my experiments, evolving with Haiku (fastest and cheapest) costs around $0.10-0.20 for 6 children, Sonnet 4.6 costs $0.75-0.85, and Opus 4.6 (by far the best, but also most expensive) costs around $5 for 6 children, or $3.50 for a mashup with 4 children, so be careful with Opus especially! The app reports the cost for each operation as it goes; check the Evolution Log at the bottom. Unfortunately Anthropic does not allow use of your Claude subscription; you need a separate API key that gets charged per million tokens.

### Built-in Shader Library                                                                             
                                                                                                      
All user shaders automatically have access to ~60 utility functions from two WGSL libraries
(noise.wgsl and utils.wgsl), as well as all the standard WebGPU functions.
                                                                                                      
####  Noise & Procedural Generation                                                                       
  - Hash functions (`pcg`, `hash21`, `hash22`) for deterministic pseudo-randomness
  - Value noise, classic Perlin noise, and simplex noise (2D)
  - Multi-octave fractal noise  (`fbmPerlin`, `fbmSimplex`,  `fbmValue`, `fbmPerlinCustom`)
  - Specialized patterns: `turbulence`, `ridgeNoise`, `cellularNoise` (Voronoi), and `domainWarp`

####  Math & Color
  - Math: `saturate`, `remap`, `lerp`, `wrap`, `repeat`, `pingpong`, `smooth_min/max`
  - Fast approximations for exp, log, and inverse square root
  - Color space conversions for hsv/rgb/linear

####  Geometry & SDFs
  - 2D signed distance functions for polygons: triangle, pentagon, hexagon, octagon, star, pentagram,
  hexagram
  - `radialSymmetry` for N-way rotational symmetry with optional mirroring
  - `hexGrid` for hexagonal tiling coordinates

####  Compositing & Coordinates
  - Screen blend mode (`screen`, `screen_color`)
  - `get_uv` for normalized coordinates with zoom/pan support and aspect-ratio correction
  - Matrix helpers (`orthonormal_basis`, `outer`, `mul_point`, `mul_vector`)


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
