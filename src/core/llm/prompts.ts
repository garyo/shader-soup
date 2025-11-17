/**
 * LLM Prompt Templates for Shader Evolution
 */

import Anthropic from "@anthropic-ai/sdk";

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

/**
 * Mutation prompt - asks Claude to creatively modify a shader
 */
export function createMutationPrompt(params: MutationPromptParams): string {
  const creativityLevel = params.temperature > 0.75 ? 'very creative and experimental'
    : params.temperature > 0.65 ? 'moderately creative with bold experimentation'
    : 'creative with some variation';

  const changeCount = Math.floor(params.temperature * 8) + 2; // 2-10 changes

  return `You are a creative WebGPU shader developer. Your task is to mutate the following WGSL compute shader in ${creativityLevel} ways.

ORIGINAL SHADER:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

AVAILABLE NOISE LIBRARY:
All shaders have access to a comprehensive noise library that is automatically included. You can use any of these functions:

Hash Functions:
- pcg(n: u32) -> u32
- xxhash32(n: u32) -> u32
- hash21(p: vec2f) -> f32
- hash22(p: vec2f) -> vec2f

Noise Functions:
- valueNoise2(p: vec2f) -> f32 - Simple value noise
- perlinNoise2(p: vec2f) -> f32 - Classic Perlin noise (returns -1 to 1)
- cellularNoise(p: vec2f) -> f32 - Voronoi-like cellular noise

Fractal/Layered Noise (FBM):
- fbmPerlin(p: vec2f) -> f32 - 4-octave Perlin FBM
- fbmValue(p: vec2f) -> f32 - 4-octave value FBM
- fbmPerlinCustom(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32

Special Patterns:
- turbulence(p: vec2f, octaves: i32) -> f32 - Absolute value noise
- ridgeNoise(p: vec2f, octaves: i32) -> f32 - Inverted ridges
- domainWarp(p: vec2f, amount: f32) -> vec2f - Distort space with noise

MUTATION GUIDELINES:
- Make ${changeCount} DISTINCT creative changes to the shader logic
- Creativity level: ${creativityLevel}
- Each mutation should produce VISUALLY DIFFERENT results
- Ideas: change color calculations, add new mathematical functions (sin, cos, abs, fract, mix), alter patterns, combine operations differently, use different coordinate transformations
- USE THE NOISE LIBRARY: Incorporate perlinNoise2, fbmPerlin, cellularNoise, turbulence, domainWarp, and other noise functions for organic patterns
- IMPORTANT: Make each mutation VISUALLY DISTINCT from the original and from previous mutations
- Try different approaches: spiral patterns, wave interference, cellular automata, fractals, noise functions (Perlin, FBM, cellular, turbulence)
- Vary the mathematical operations: use different combinations of trig functions, exponentials, power functions, AND noise functions
- Experiment with color schemes: HSV conversions, complementary colors, gradients, discrete color palettes, noise-based coloring
- You MUST preserve the overall structure:
  * Keep @compute @workgroup_size annotation
  * Keep @group and @binding declarations for coords, output${params.preserveParams ? ', and params' : ''}
  * Keep the main function signature
${params.preserveParams ? '  * Keep all @param comments with same format: // @param name: min, max, default, step' : '  * You may add, remove, or modify @param comments'}
- The shader should still compile and produce visual output
- Be creative with the visual logic but maintain technical correctness
- AVOID making the same type of change multiple times - be diverse!

OUTPUT FORMAT:
Return ONLY the complete mutated shader code, nothing else. Do not include explanations or markdown code blocks.`;
}

/**
 * Batch mutation prompt - asks Claude to generate multiple diverse variations at once
 */
export function createBatchMutationPrompt(params: BatchMutationPromptParams): string {
  return `You are a creative WebGPU shader developer. Your task is to generate ${params.count} different mutations of the following WGSL compute shader.

ORIGINAL SHADER:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

AVAILABLE NOISE LIBRARY:
All shaders have access to a comprehensive noise library that is automatically included. You can use any of these functions:

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

Example usage:
  let noise = perlinNoise2(coord * 5.0);  // Scale coordinates for detail level
  let clouds = fbmPerlin(coord * 3.0);    // Layered noise for clouds
  let marble = sin(coord.x * 10.0 + turbulence(coord * 5.0, 4) * 3.0);  // Marble veining
  let warped = domainWarp(coord * 4.0, 0.5);  // Organic distortion
  let cells = cellularNoise(coord * 8.0);     // Cell-like patterns

CRITICAL REQUIREMENTS:
- Generate EXACTLY ${params.count} variations
- Use a temperature of ${params.temperature}: 0 means no change at all (return the original), 1.0 means make many changes
- Each variation should be VISUALLY DISTINCT from all others; start each one with a different random seed.
- Each variation should be SYNTACTICALLY CORRECT to your best approximation (a debugger will run after this)
- Things you can change:
  - Vary constant values (higher temp = wider variation)
  - Vary param values and ranges (higher temp = wider variation)
  - Vary operators (+, -, *, /, powers etc.)
  - Vary functions: replace with other ones, change arg orders
  - Add noise functions: Use perlinNoise2, fbmPerlin, cellularNoise, turbulence, domainWarp, etc.
  - Vary code structure: swap statement orders, add or delete statements or loops or conditionals
  - Write new functions and use them
- With a temp of 0.1, change 1 or 2 of each of those. With a temp of 0.5, change around 5 of each of those. With a temp of 1.0, change most of them so the result is very different from the original.

TECHNICAL CONSTRAINTS:
- You MUST preserve the structure in each variation:
  * Keep @compute @workgroup_size annotation
  * Keep @group and @binding declarations for coords, output${params.preserveParams ? ', and params' : ''}
  * Keep the main function signature
${params.preserveParams ? '  * Keep all @param comments with same format: // @param name: min, max, default, step' : '  * You may add, remove, or modify @param comments, keeping the same format'}
- Each shader must compile and produce visual output

OUTPUT FORMAT:
Use the shader_output tool to return your ${params.count} shader variations.
The tool expects a JSON object with a "shaders" array, each containing a "shader" field with the complete WGSL code and optionally a "changelog" field noting significant changes, including how many constants/operators/functions/structural changes were made.
`;
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


/**
 * Debug prompt - asks Claude to fix compilation errors
 */
export function createDebugPrompt(params: DebugPromptParams): string {
  return `You are debugging a WGSL compute shader that may have compilation errors. Fix the errors while preserving the creative intent of the shader.

SHADER WITH ERRORS:
\`\`\`wgsl
${params.shaderSource}
\`\`\`

COMPILATION ERRORS:
${params.errors}

AVAILABLE NOISE LIBRARY:
All shaders have access to these noise functions (automatically included):
- perlinNoise2, fbmPerlin, fbmValue, fbmPerlinCustom, valueNoise2
- cellularNoise, turbulence, ridgeNoise, domainWarp
- hash21, hash22, pcg, xxhash32

DEBUG INSTRUCTIONS (Attempt ${params.attempt}):
- Fix ALL compilation errors
- Preserve the shader's creative visual logic as much as possible
- Maintain the structure: @compute, @group/@binding declarations, @param comments
- Common WGSL issues to watch for:
  * Type mismatches (f32 vs u32 vs i32)
  * Missing semicolons or incorrect syntax
  * Undefined functions or variables
  * Incorrect binding numbers or types
  * Array access out of bounds
- If a creative feature can't compile, simplify it slightly but keep the spirit

OUTPUT FORMAT:
Use the debug_shader_output tool to return the fixed shader code.`;
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
