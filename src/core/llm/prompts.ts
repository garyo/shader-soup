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
- pcg(n: u32) -> u32
- xxhash32(n: u32) -> u32
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
- saturate(x): Clamp x to [0,1].
- saturate_v2(v): Clamp vec2 to [0,1].
- saturate_v3(v): Clamp vec3 to [0,1].
- saturate_v4(v): Clamp vec4 to [0,1].
- inv_lerp(a,b,v): Return normalized position of v in [a,b].
- remap(inMin,inMax,outMin,outMax,v): Map v from one range to another.
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

BIT OPERATIONS
- popcount(x): Count bits set in a u32.
- rotl(x,k): Rotate-left.
- rotr(x,k): Rotate-right.

GEOMETRY
- orthonormal_basis(n): Build 3x3 basis from normal vector n.

MATRIX HELPERS
- outer(a,b): Outer product matrix.
- mul_point(m,p): Multiply point by 4x4 matrix (with w=1).
- mul_vector(m,v): Multiply direction vector by 4x4 (w=0).`;

const BINDING_REQUIREMENTS = `* Keep @group and @binding declarations with the REQUIRED binding layout:
  - @binding(0): coordTexture: texture_2d<f32>
  - @binding(1): coordSampler: sampler
  - @binding(2): output: array<vec4<f32>>
  - @binding(3): dimensions: Dimensions (uniform)
  - @binding(4): params: Params (uniform, optional)`;

const COORDINATE_SAMPLING = ` * Input coordTexture is normalized, with 0,0 in the image center, -1 to +1 in X, with square texels.
  * Calculate basic texCoord and sample coordinates like this:
    let texCoord = vec2<f32>(
      f32(id.x) / f32(dimensions.width),
      f32(id.y) / f32(dimensions.height)
    );
    let coord = textureSampleLevel(coordTexture, coordSampler, texCoord, 0.0).rg;`

const PARAMETER_FORMAT = `PARAMETERS:
* To add parameters, define a Params struct and bind it at @binding(4):
  struct Params {
    frequency: f32,  // min=0.1, max=10.0, default=2.0, step=0.1
    amplitude: f32,  // min=0.0, max=5.0, default=1.0, step=0.1
    speed: f32,      // min=-2.0, max=2.0, default=0.5, step=0.05
  }

  @group(0) @binding(4) var<uniform> params: Params;

* The inline comment format is: // min=X, max=Y, default=Z, step=W
* All fields are optional - if omitted, defaults are: min=0, max=10, default=1, step=0.01
* Parameters appear as sliders in the UI for real-time control
* You can add, remove, or modify parameters freely`

// Cacheable system prompt with all library documentation
const SYSTEM_PROMPT_BASE = `You are a highly creative WebGPU shader developer.

${NOISE_LIBRARY_DOCS}

${UTILS_LIBRARY_DOCS}

TECHNICAL REQUIREMENTS:
- You MUST preserve the shader structure:
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

EXPERIMENTATION WORKFLOW:
- You have access to a render_shader tool that lets you SEE what your mashup looks like!
- Use this to try different combination strategies before committing
- You can render up to 3 test shaders to explore the creative space
- Experiment boldly - you can iterate until you find something visually interesting
- Once you've found ${params.count} compelling mashups through experimentation, output them with shader_output

SELECTION CRITERIA FOR FINAL OUTPUT:
- Prefer visually interesting, complex, and dynamic patterns
- Avoid repetitive, boring, or overly simple results
- Choose variations that are aesthetically compelling and have visual depth
- Select shaders that successfully combine techniques in novel ways
- If an experiment looks bland or uninteresting, try a different approach
- If your first (or any) experiment looks good, it's OK to use that to save time - you don't always have to try all available experiments

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

EXPERIMENTATION WORKFLOW:
- You have access to a render_shader tool that lets you SEE what a shader looks like!
- Use this tool to experiment with different ideas before finalizing your variations
- Try bold experiments - if they don't look good, you can try something else
- You can render up to 3 test shaders to explore the creative space
- Once you've found interesting variations through experimentation, output them with shader_output

SELECTION CRITERIA FOR FINAL OUTPUT:
- Prefer visually interesting, complex, and dynamic patterns
- Avoid repetitive, boring, or overly simple results
- Choose variations that are aesthetically compelling and have visual depth
- Select mutations that create novel visual effects while maintaining some connection to the parent
- If an experiment looks bland or uninteresting, try a different approach
- If your first (or any) experiment looks good, it's OK to use that to save time - you don't always have to try all available experiments

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
  - Think about abstract patterns, interesting variations and "out-of-the-box" ideas
  - Add functions for rotation and other creative coordinate transformations when you feel like it
  - Don't be afraid to add new functions and use them!
  - It's OK to add code and change things without knowing what it'll look like. Just be creative.
  - Add params for interesting constants
  - After evolving, you may delete any params that don't do anything interesting.
- With a temp of 0.1, change 1 or 2 of each of those. With a temp of 0.5, change around 5 of each of those. With a temp of 1.0, change most of them so the result is VERY different from the original.
- With a temp > 0.8, be super creative and invent brand new looks, not just basic variations of the source.
- BE CREATIVE!

OUTPUT FORMAT:
Use the shader_output tool to return your ${params.count} shader variations.
The tool expects a JSON object with a "shaders" array, each containing a "shader" field with the complete WGSL code and optionally a "changelog" field noting significant changes, including how many constants/operators/functions/structural changes were made.`;

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
  * @binding(0): coordTexture: texture_2d<f32>
  * @binding(1): coordSampler: sampler
  * @binding(2): output buffer
  * @binding(3): dimensions uniform
  * @binding(4): params uniform (optional - if present, must have a Params struct)
- Ensure coordinates are sampled using textureSampleLevel(coordTexture, coordSampler, texCoord, 0.0).rg
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
