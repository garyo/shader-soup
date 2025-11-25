// Sine Wave Pattern Generator
// Creates a wave pattern based on coordinates with adjustable parameters

struct Dimensions {
  width: u32,
  height: u32,
  _pad1: u32,
  _pad2: u32,
}

struct Params {
  frequency: f32,   // min=0.0, max=20.0, default=5.0, step=0.1
  amplitude: f32,   // min=0.0, max=2.0, default=1.0, step=0.05
  phase: f32,       // min=0.0, max=6.28, default=0.0, step=0.1
  colorShift: f32,  // min=0.0, max=1.0, default=0.0, step=0.01
}

@group(0) @binding(0) var coordTexture: texture_2d<f32>;
@group(0) @binding(1) var coordSampler: sampler;
@group(0) @binding(2) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  let index = id.y * dimensions.width + id.x;
  let texCoord = vec2<f32>(
    f32(id.x) / f32(dimensions.width),
    f32(id.y) / f32(dimensions.height)
  );
  let coord = textureSampleLevel(coordTexture, coordSampler, texCoord, 0.0).rg;

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
