// Sine Wave Pattern Generator
// Creates a wave pattern based on coordinates with adjustable parameters

// @param frequency: 0.0, 20.0, 5.0, 0.1
// @param amplitude: 0.0, 2.0, 1.0, 0.05
// @param phase: 0.0, 6.28, 0.0, 0.1
// @param colorShift: 0.0, 1.0, 0.0, 0.01

struct Dimensions {
  width: u32,
  height: u32,
  _pad1: u32,
  _pad2: u32,
}

struct Params {
  frequency: f32,
  amplitude: f32,
  phase: f32,
  colorShift: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> dimensions: Dimensions;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  let index = id.y * dimensions.width + id.x;
  let coord = coords[index];

  // Create wave pattern
  let wave = sin(coord.x * params.frequency + params.phase) * params.amplitude;

  // Map wave to 0-1 range
  let brightness = (wave + params.amplitude) / (2.0 * params.amplitude);

  // Create colorful pattern
  let r = brightness;
  let g = sin(brightness * 6.28 + params.colorShift) * 0.5 + 0.5;
  let b = cos(brightness * 6.28 + params.colorShift) * 0.5 + 0.5;

  output[index] = vec4<f32>(r, g, b, 1.0);
}
