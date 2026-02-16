/**
 * LLM Prompt Templates for Shader Evolution
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// Shared Prompt Components
// ============================================================================

const NOISE_LIBRARY_DOCS = `AVAILABLE NOISE LIBRARY:
All shaders have access to a comprehensive noise library that is automatically included. You can use any of these functions (or write your own custom functions with DIFFERENT names):

Hash Functions:
- pcg(n: u32) -> u32 // PCG-RXS-M-XS hash function, very good
- hash_u32(n: u32) -> u32 // lowbias32 hash function, very good
- hash21(p: vec2f) -> f32 - Hash 2D position to float [0,1]
- hash22(p: vec2f) -> vec2f - Hash 2D position to vec2 [0,1]

Noise Functions:
- valueNoise2(p: vec2f) -> f32 - Simple value noise [0,1]
- perlinNoise2(p: vec2f) -> f32 - Classic Perlin noise (returns ~-1 to 1)
- cellularNoise(p: vec2f) -> f32 - Voronoi-like cellular noise

Fractal/Layered Noise (FBM - Fractional Brownian Motion):
- fbmPerlin(p: vec2f) -> f32 - 4-octave Perlin FBM
- fbmValue(p: vec2f) -> f32 - 4-octave value FBM
- fbmPerlinCustom(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 - Customizable FBM

Special Patterns:
- turbulence(p: vec2f, octaves: i32) -> f32 - Absolute value noise for turbulent patterns
- ridgeNoise(p: vec2f, octaves: i32) -> f32 - Inverted ridges for mountain-like patterns
- domainWarp(p: vec2f, amount: f32) -> vec2f - Distort coordinate space with noise

CRITICAL: DO NOT redefine any of these functions! They are automatically provided. If you need a custom noise function, give it a DIFFERENT name (e.g., customHash, myNoise, specialPerlin).`;

const UTILS_LIBRARY_DOCS = `All shaders have access to the following WGSL utility functions.
They are safe, branch-minimal, and designed for compute shaders.
These functions are automatically provided - DO NOT redefine them!

SCALAR / VECTOR MATH
- saturate(v: vec3): Clamp vec3 to [0,1] (most common — use for colors).
- saturate_f32(x): Clamp scalar f32 to [0,1].
- saturate_v2(v): Clamp vec2 to [0,1].
- saturate_v4(v): Clamp vec4 to [0,1].
- inv_lerp(a,b,v): Return normalized position of v in [a,b].
- remap(v, inMin,inMax,outMin,outMax): Map v from one range to another.
- wrap(x,range): Wrap x into [0,range).
- repeat(x,r): Repeat x modulo r; same as wrap but semantic name.
- pingpong(x,length): Triangle-wave wrap for oscillation.
- smooth_min(a,b,k): Smoothly blend min(a,b) with softness k.
- smooth_max(a,b,k): Smoothly blend max(a,b) with softness k.
- safe_normalize(v): Normalize v; returns zero vector if length is zero.

MODF (fraction + integer parts)
- modf(x: f32): Return struct { fract: f32, ipart: f32 } where fract = x - trunc(x).
- modf(x: vec3<f32>): Return struct { fract: vec3<f32>, ipart: vec3<f32> } using elementwise trunc.

FAST APPROX MATH
- fast_inv_sqrt(x): Fast approximate 1/sqrt(x).
- fast_exp(x): Cheap polynomial approx of exp(x) (low precision).
- fast_log(x): Cheap polynomial approx of log(x) (low precision).

RNG / HASHING
- hash_u32(x): One-way 32-bit integer hash.
- rand_f32(seed): Deterministic float32 in [0,1] from integer seed.

COLOR HELPERS
- linear_to_srgb(c): Convert linear RGB to sRGB.
- srgb_to_linear(c): Convert sRGB to linear RGB.
- hsv_to_rgb(h,s,v): Convert HSV to RGB (h in radians 0 to 2π, s and v in 0 to 1).
- rgb_to_hsv(rgb): Convert RGB to HSV (returns vec3(h,s,v) with h in radians 0 to 2π).
- screen(a: vec3<f32>, b: vec3<f32>) -> vec3<f32>: "screen" blend operator for combining 0-1 color values (e.g. RGB). Use this instead of + for better results.
- screen_f32(a: f32, b: f32) -> f32: scalar "screen" blend operator for combining 0-1 values.


BIT OPERATIONS
- popcount(x): Count bits set in a u32.
- rotl(x,k): Rotate-left.
- rotr(x,k): Rotate-right.

GEOMETRY
- orthonormal_basis(n): Build 3x3 basis from normal vector n.
- radialSymmetry(p: vec2f, n: i32, mirror: bool) -> vec2f: N-way rotational symmetry with optional mirroring
  // n: number of symmetry sectors (e.g., 6 for hexagonal)
  // mirror: if true, mirrors every other sector for true reflection symmetry
- hexGrid(p: vec2f) -> vec4f: hexagonal grid. Returns: xy = cell coordinates, z = cell ID hash, w = distance from center

2D SIGNED DISTANCE FUNCTIONS (POLYGONS) - great for geometric art, logos, tiling, and abstract patterns!
All return negative inside, positive outside (from Inigo Quilez). Use these to create crisp geometric shapes:
- sdEquilateralTriangle(p: vec2f, r: f32) -> f32: Equilateral triangle, circumradius r
- sdTriangleIsosceles(p: vec2f, q: vec2f) -> f32: Isosceles triangle, q.x=half-width, q.y=height
- sdTriangle(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32: General triangle with 3 vertices
- sdPentagon(p: vec2f, r: f32) -> f32: Regular pentagon, circumradius r
- sdHexagon(p: vec2f, r: f32) -> f32: Regular hexagon, circumradius r
- sdOctagon(p: vec2f, r: f32) -> f32: Regular octagon, circumradius r
- sdStar(p: vec2f, r: f32, n: i32, m: f32) -> f32: Regular star, r=outer radius, n=points, m=star ratio (2 < m < n)
- sdPentagram(p: vec2f, r: f32) -> f32: Pentagram (five-pointed star), circumradius r
- sdHexagram(p: vec2f, r: f32) -> f32: Hexagram (Star of David), circumradius r
Techniques: smooth_min/smooth_max to blend shapes organically, step/smoothstep for crisp/soft edges,
  abs(d) for outlines, fract(d*N) for concentric rings, noise to warp coordinates before SDF for organic geometry,
  repeat coordinates with fract()/wrap() to tile shapes, combine multiple SDFs with min/max for boolean ops.

MATRIX HELPERS
- outer(a,b): Outer product matrix.
- mul_point(m,p): Multiply point by 4x4 matrix (with w=1).
- mul_vector(m,v): Multiply direction vector by 4x4 (w=0).`;

const BINDING_REQUIREMENTS = `* Keep @group and @binding declarations with the REQUIRED binding layout:
  - @binding(0): output: texture_storage_2d<rgba32float, write>
  - @binding(1): dimensions: Dimensions (uniform, includes zoom/pan)
  - @binding(2): params: Params (uniform, optional)
  - @binding(3-4): input texture/sampler (optional, for feedback/image processing)`;

const COORDINATE_SAMPLING = ` * Get normalized UV coordinates using the get_uv() helper function:
  * The function returns vec2<f32> with:
  *   - X: -1.0 (left) to 1.0 (right)
  *   - Y: aspect-ratio scaled, centered at 0.0
  * Example usage:
    let coord = get_uv(
      id.xy,
      dimensions.width,
      dimensions.height,
      vec2<f32>(dimensions.panX, dimensions.panY),
      dimensions.zoom
    );
  * The Dimensions struct includes zoom, pan, and animation fields:
    struct Dimensions {
      width: u32,
      height: u32,
      zoom: f32,
      _pad1: u32,
      panX: f32,
      panY: f32,
      time: f32,      // elapsed seconds since animation start (use for animation!)
      frame: u32,     // frame counter
    }
  * Animation: Use dimensions.time for continuous animation effects:
    let wave = sin(coord.x * 5.0 + dimensions.time * 2.0);  // Scrolling wave
    let pulse = 0.5 + 0.5 * sin(dimensions.time * 3.0);      // Pulsing value
    let spiral = atan2(coord.y, coord.x) + dimensions.time;   // Rotating spiral`

const PARAMETER_FORMAT = `PARAMETERS:
* To add parameters, define a Params struct and bind it at @binding(2):
  struct Params {
    frequency: f32,  // min=0.1, max=10.0, default=2.0, step=0.1
    amplitude: f32,  // min=0.0, max=5.0, default=1.0, step=0.1
    speed: f32,      // min=-2.0, max=2.0, default=0.5, step=0.05
  }

  @group(0) @binding(2) var<uniform> params: Params;

* The inline comment format is: // min=X, max=Y, default=Z, step=W
* All fields are optional - if omitted, defaults are: min=0, max=10, default=1, step=0.01
* Parameters appear as sliders in the UI for real-time control
* You can add, remove, or modify parameters freely`

// Cacheable system prompt with all library documentation
const SYSTEM_PROMPT_BASE = `You are a highly creative WebGPU shader developer. Your goal is to create something new, unique and beautiful by evolving the input shaders, adding your own ideas, refactoring and modifying according to the temperature. Think about symmetry, color, texture, light and shadow.

${NOISE_LIBRARY_DOCS}

${UTILS_LIBRARY_DOCS}

TECHNICAL REQUIREMENTS:
- You MUST preserve the overall shader structure:
  * Keep @compute @workgroup_size annotation
  ${BINDING_REQUIREMENTS}
  ${COORDINATE_SAMPLING}
  * Keep the main function signature

${PARAMETER_FORMAT}

- All shaders must compile and produce visual output
- Note: for the modulus (mod) operator, use the utility modf(x)
- DO NOT copy helper functions from parent shaders - those are likely from the automatically-included libraries`

// ============================================================================
// Type Definitions
// ============================================================================

export interface MutationPromptParams {
  shaderSource: string;
  temperature: number;
  preserveParams: boolean;
}

export interface BatchMutationPromptParams {
  shaderSource: string;
  count: number;
  temperature: number,
  preserveParams: boolean;
}

export interface DebugPromptParams {
  shaderSource: string;
  errors: string;
  attempt: number;
}

export interface ParameterNamingPromptParams {
  shaderSource: string;
  currentParams: Array<{ name: string; min: number; max: number; default: number; step: number }>;
}

export interface MashupPromptParams {
  shaders: Array<{ name: string; source: string }>;
  count: number;
  temperature: number;
}

export interface PromptWithSystem {
  system: string;
  user: string;
}

/**
 * Mashup prompt - asks Claude to combine multiple shaders into new variations
 * Returns system (cacheable) and user (task-specific) parts
 */
export function createMashupPrompt(params: MashupPromptParams): PromptWithSystem {
  const shaderList = params.shaders
    .map((shader, index) => `SHADER ${index + 1}: "${shader.name}"\n\`\`\`wgsl\n${shader.source}\n\`\`\``)
    .join('\n\n');

  const system = SYSTEM_PROMPT_BASE;

  const user = `Your task is to create ${params.count} new shaders by creatively, randomly inventing, combining and mashing up techniques from these ${params.shaders.length} shaders:

${shaderList}

EXPERIMENTATION (OPTIONAL):
- You have access to a render_shader tool that lets you SEE what your mashup looks like
- You already have images of the parent shaders above, so DO NOT re-render them
- If you're confident in your mashup, skip experimenting and go DIRECTLY to shader_output — this is faster and preferred
- Only use render_shader if you're truly unsure and want to test a creative choice
- You can render up to 3 test shaders, but 0 is fine if you're confident

SELECTION CRITERIA:
- Prefer visually interesting, complex, and dynamic patterns
- Choose variations that are aesthetically compelling and combine techniques in novel ways

MASHUP GUIDELINES:
- Generate EXACTLY ${params.count} mashup variations
- Use a temperature of ${params.temperature} (0 = conservative, 1 = very creative)
- Each mashup should COMBINE techniques from the parent shaders in interesting ways, and add or change elements
- Think about how to blend visual elements: layering, modulation, conditional mixing, spatial transitions
- Don't repeat yourself; always try something different from previous attempts
- Look at the previous prompt's images and try to branch out; the higher the temperature, the more you should vary the result
- Think about how to blend mathematical techniques even when you can't predict the visual outcomes
- Examples of mashup techniques:
  * Use the pattern generation from one shader but color scheme from another
  * Layer outputs: multiply, add, or mix colors from different techniques
  * Use one shader's pattern to modulate parameters of another shader's pattern
  * Apply one shader's coordinate transformation before another shader's logic
  * Use conditional logic to blend regions: if (coord.x < 0.5) use technique A else technique B
  * Domain warp one shader's coordinates using noise from another
  * Combine color palettes: alternate bands, radial transitions, noise-based selection
- Each variation should be VISUALLY and MATHEMATICALLY DISTINCT
- Be creative in how you combine the parent shaders - don't just linearly interpolate!

OUTPUT FORMAT:
Use the shader_output tool to return your ${params.count} mashup variations.
The tool expects a JSON object with a "shaders" array, each containing:
- "name" (required): A creative, concise title (2-4 words) that captures the essence of this mashup (e.g., "Chromatic Spiral Drift", "Cellular Wave Morph", "Turbulent Color Dance")
- "shader" (required): The complete WGSL code
- "changelog" (optional): Brief notes on how the parent shaders were combined

Be creative with the names - use evocative, descriptive titles that hint at the visual or mathematical nature of the mashup!`;

  return { system, user };
}

/**
 * Mutation prompt - asks Claude to creatively modify a shader
 * Returns system (cacheable) and user (task-specific) parts
 */
export function createMutationPrompt(params: MutationPromptParams): PromptWithSystem {
  const creativityLevel = params.temperature > 0.75 ? 'very creative and experimental'
    : params.temperature > 0.65 ? 'moderately creative with bold experimentation'
    : 'creative with some variation';

  const changeCount = Math.floor(params.temperature * 8) + 2; // 2-10 changes

  const system = SYSTEM_PROMPT_BASE;

  const user = `Your task is to mutate the following WGSL compute shader in ${creativityLevel} ways.

ORIGINAL SHADER:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

MUTATION GUIDELINES:
- Make ${changeCount} DISTINCT creative changes to the shader logic
- Creativity level: ${creativityLevel}
- Each mutation should produce VISUALLY DIFFERENT results
- Don't repeat yourself; always try something different from previous attempts
- Ideas: change color calculations, add new mathematical functions (sin, cos, abs, fract, mix), alter patterns, combine operations differently, use different coordinate transformations
- USE THE NOISE LIBRARY: Incorporate perlinNoise2, fbmPerlin, cellularNoise, turbulence, domainWarp, and other noise functions for organic patterns
- USE SDF SHAPES: Try sdHexagon, sdStar, sdPentagram, sdEquilateralTriangle, sdOctagon etc. for crisp geometric forms. Combine with smooth_min for organic blends, fract() for rings, or noise for warped geometry
- IMPORTANT: Make each mutation VISUALLY DISTINCT from the original and from previous mutations
- Try different approaches: spiral patterns, wave interference, cellular automata, fractals, noise functions (Perlin, FBM, cellular, turbulence)
- Vary the mathematical operations: use different combinations of trig functions, exponentials, power functions, AND noise functions
- Experiment with color schemes: HSV conversions, complementary colors, gradients, discrete color palettes, noise-based coloring
- The shader should still compile and produce visual output
- Be creative with the visual logic but maintain technical correctness
- AVOID making the same type of change multiple times - be diverse!

OUTPUT FORMAT:
Return ONLY the complete mutated shader code, nothing else. Do not include explanations or markdown code blocks.`;

  return { system, user };
}

/**
 * Batch mutation prompt - asks Claude to generate multiple diverse variations at once
 * Returns system (cacheable) and user (task-specific) parts
 */
export function createBatchMutationPrompt(params: BatchMutationPromptParams): PromptWithSystem {
  const system = SYSTEM_PROMPT_BASE;

  const user = `Your task is to generate ${params.count} different mutations of the following WGSL compute shader.

ORIGINAL SHADER:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

NOISE LIBRARY EXAMPLES:
  let noise = perlinNoise2(coord * 5.0);  // Scale coordinates for detail level
  let clouds = fbmPerlin(coord * 3.0);    // Layered noise for clouds
  let marble = sin(coord.x * 10.0 + turbulence(coord * 5.0, 4) * 3.0);  // Marble veining
  let warped = domainWarp(coord * 4.0, 0.5);  // Organic distortion
  let cells = cellularNoise(coord * 8.0);     // Cell-like patterns

ANIMATION EXAMPLES (use dimensions.time for moving/animated effects!):
  let wave = sin(coord.x * 5.0 + dimensions.time * 2.0);  // Scrolling wave
  let pulse = 0.5 + 0.5 * sin(dimensions.time * 3.0);      // Pulsing value
  let spiral = atan2(coord.y, coord.x) + dimensions.time;   // Rotating spiral
  let flow = fbmPerlin(coord * 3.0 + vec2f(dimensions.time * 0.5, 0.0));  // Flowing noise

SDF SHAPE EXAMPLES (polygon signed distance functions - great for geometric patterns!):
  let d = sdHexagon(coord, 0.4);                              // Hexagon shape
  let d = sdStar(coord, 0.5, 5, 2.5);                         // 5-pointed star
  let d = smooth_min(sdHexagon(coord, 0.3), sdPentagram(coord - vec2f(0.3, 0.0), 0.2), 0.1);  // Blended shapes
  let rings = fract(sdOctagon(coord, 0.5) * 10.0);            // Concentric octagon rings
  let warped_hex = sdHexagon(domainWarp(coord * 3.0, 0.3), 0.3);  // Organic warped hexagon
  let color = hsv_to_rgb(d * 3.0, 0.8, smoothstep(0.01, -0.01, d));  // Color from distance

EXPERIMENTATION (OPTIONAL):
- You have access to a render_shader tool that lets you SEE what a shader looks like
- If you're confident in your mutation, skip experimenting and go DIRECTLY to shader_output — this is faster and preferred
- Only use render_shader if you're truly unsure about a creative choice and want to test it
- You can render up to 3 test shaders, but 0 is fine if you're confident

SELECTION CRITERIA:
- Prefer visually interesting, complex, and dynamic patterns
- Avoid repetitive, boring, or overly simple results
- Aim for aesthetic depth and novel visual effects

CRITICAL REQUIREMENTS:
- Generate EXACTLY ${params.count} variations
- Use a temperature of ${params.temperature}: 0 means no change at all (return the original), 1.0 means make many changes
- Each variation should be VISUALLY DISTINCT from all others; start each one with a different random seed.
- Each variation should be SYNTACTICALLY CORRECT to your best approximation (a debugger will run after this)
- With trig functions, try to keep spatial continuity by mostly preferring full rotations or angle params that end up where they start
- Things you can change:
  - Vary constant values (higher temp = wider variation)
  - Vary param values and ranges (higher temp = wider variation)
  - Vary operators (+, -, *, /, powers etc.)
  - Vary functions: replace with other ones, change arg orders
  - Add noise functions: Use perlinNoise2, fbmPerlin, cellularNoise, turbulence, domainWarp, etc.
  - Vary code structure: swap statement orders, add or delete statements or loops or conditionals
  - Write new functions and use them
  - Think about new math operations (abs, modf, ceil/floor, dot, cross, fract, min, max)
  - Think about symmetry vs. asymmetry: mirror, kaleidoscope, shapes (triangle/square/hex/circles)
  - Use SDF shape functions (sdHexagon, sdStar, sdPentagram, sdEquilateralTriangle, sdOctagon, etc.) for geometric patterns, tiling, outlines, or blended organic forms
  - Think about abstract patterns, interesting variations and "out-of-the-box" ideas
  - Add functions for rotation and other creative coordinate transformations when you feel like it
  - Don't be afraid to add new functions and use them!
  - It's OK to add code and change things without knowing what it'll look like. Just be creative.
  - Add params for interesting constants
  - After evolving, you may delete any params that don't do anything interesting.
  - Try using dimensions.time to add animation! Shaders animate on mouse-over. Add scrolling, pulsing, rotating, or flowing effects.
- With a temp of 0.1, change 1 or 2 of each of those. With a temp of 0.5, change around 5 of each of those. With a temp of 1.0, change most of them so the result is VERY different from the original.
- With a temp > 0.8, be super creative and invent brand new looks, not just basic variations of the source.
- BE CREATIVE!

OUTPUT FORMAT:
Use the shader_output tool to return your ${params.count} shader variations.
The tool expects a JSON object with a "shaders" array, each containing:
- "name" (required): A creative, concise title (2-4 words) that captures the visual essence (e.g., "Fractal Bloom", "Neon Hex Grid", "Warped Starfield")
- "shader" (required): The complete WGSL code
- "changelog" (optional): Brief notes on significant changes`;

  return { system, user };
}

export const shaderObjectTool: Anthropic.Tool = {
  "name": "shader_output",
  "description": "Returns an array of shader objects",
  "input_schema": {
    "type": "object",
    "properties": {
      "shaders": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "Creative name for the shader (2-4 words)",
            },
            "shader": {
              "type": "string",
              "description": "The shader code",
            },
            "changelog": {
              "type": "string",
              "description": "Summary of changes in this version",
            }
          },
          "required": ["shader"]
        }
      }
    },
    "required": ["shaders"]
  }
}

export const debugShaderTool: Anthropic.Tool = {
  "name": "debug_shader_output",
  "description": "Returns a fixed shader after debugging",
  "input_schema": {
    "type": "object",
    "properties": {
      "shader": {
        "type": "string",
        "description": "The fixed shader code"
      }
    },
    "required": ["shader"]
  }
}

export const parameterNamesTool: Anthropic.Tool = {
  "name": "parameter_names_output",
  "description": "Returns an array of parameter names",
  "input_schema": {
    "type": "object",
    "properties": {
      "names": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Parameter name in camelCase"
        },
        "description": "Array of parameter names in the same order as the input parameters"
      }
    },
    "required": ["names"]
  }
}

export const renderShaderTool: Anthropic.Tool = {
  "name": "render_shader",
  "description": "Render a WGSL shader and see its visual output as an image. Use this to experiment with different variations and see what they look like before finalizing your output. You can call this multiple times to try different ideas.",
  "input_schema": {
    "type": "object",
    "properties": {
      "shader": {
        "type": "string",
        "description": "The complete WGSL shader code to render"
      },
      "notes": {
        "type": "string",
        "description": "Brief notes about what you're testing with this render (for your own reference)"
      }
    },
    "required": ["shader"]
  }
}


/**
 * Debug prompt - asks Claude to fix compilation errors
 * Returns system (cacheable) and user (task-specific) parts
 */
export function createDebugPrompt(params: DebugPromptParams): PromptWithSystem {
  const system = `You are a WebGPU shader debugger.

${NOISE_LIBRARY_DOCS}

${UTILS_LIBRARY_DOCS}

TECHNICAL REQUIREMENTS:
- Maintain the REQUIRED binding structure:
  * @binding(0): output: texture_storage_2d<rgba32float, write>
  * @binding(1): dimensions: Dimensions uniform (includes zoom/pan)
  * @binding(2): params: Params uniform (optional - if present, must have a Params struct)
  * @binding(3-4): input texture/sampler (optional, for feedback/image processing)
- Get coordinates using the get_uv() helper function (automatically provided):
  let coord = get_uv(id.xy, dimensions.width, dimensions.height, vec2<f32>(dimensions.panX, dimensions.panY), dimensions.zoom);
- The Dimensions struct MUST be declared exactly as:
  struct Dimensions {
    width: u32,
    height: u32,
    zoom: f32,
    _pad1: u32,
    panX: f32,
    panY: f32,
    time: f32,
    frame: u32,
  }
  The time (f32, seconds) and frame (u32) fields enable animation. If the shader uses dimensions.time, keep it!
- If the shader has parameters, they should be in a Params struct with inline comments: // min=X, max=Y, default=Z, step=W
- Maintain @compute annotation`;

  const user = `Your task is to debug a WGSL compute shader that has compilation errors. Fix the errors while preserving the creative intent of the shader.

SHADER WITH ERRORS:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

COMPILATION ERRORS:
${params.errors}

DEBUG INSTRUCTIONS (Attempt ${params.attempt}):
- Fix ALL compilation errors
- Preserve the shader's creative visual logic as much as possible
- Common WGSL issues to watch for:
  * Type mismatches (f32 vs u32 vs i32)
  * Missing semicolons or incorrect syntax
  * Undefined functions or variables
  * Incorrect binding numbers or types
  * Array access out of bounds
  * REDECLARATION ERRORS: If you see "redeclaration of 'hash21'" or similar, DELETE the duplicate function definition - these functions are already provided by the noise/utils library
- If a creative feature can't compile, simplify it slightly but keep the spirit

OUTPUT FORMAT:
Use the debug_shader_output tool to return the fixed shader code.`;

  return { system, user };
}

/**
 * Parameter naming prompt - asks Claude to rename parameters based on shader behavior
 */
export function createParameterNamingPrompt(params: ParameterNamingPromptParams): string {
  const paramList = params.currentParams
    .map(p => `  - ${p.name}: ${p.min} to ${p.max} (default: ${p.default})`)
    .join('\n');

  return `You are analyzing a WGSL shader to determine what its parameters actually do. Read the shader code and suggest descriptive names for each parameter.

SHADER:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

CURRENT PARAMETERS:
${paramList}

TASK:
- Read the shader and understand what each parameter controls
- Suggest concise, descriptive names (1-2 words, camelCase)
- Examples: "waveFrequency", "colorShift", "patternScale", "rotationSpeed"
- Names should be clear and match what the parameter visually affects

OUTPUT FORMAT:
Use the parameter_names_output tool to return the array of parameter names in the same order as above.`;
}
