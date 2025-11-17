// Sine Wave Pattern (Texture-based Coordinates)
// Creates colorful sine wave patterns using texture coordinate lookups

// @param frequency: 1.0, 20.0, 5.0, 0.5
// @param amplitude: 0.1, 2.0, 0.5, 0.1
// @param phase: 0.0, 6.28, 0.0, 0.1
// @param colorShift: 0.0, 6.28, 0.0, 0.1

struct Dimensions {
  width: u32,
  height: u32,
}

struct Params {
  frequency: f32,
  amplitude: f32,
  phase: f32,
  colorShift: f32,
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

  // Calculate texture coordinates (0 to 1)
  let texCoord = vec2<f32>(
    f32(id.x) / f32(dimensions.width),
    f32(id.y) / f32(dimensions.height)
  );

  // Sample normalized coordinates from texture
  let coord = textureSampleLevel(coordTexture, coordSampler, texCoord, 0.0).rg;

  // Calculate sine wave
  let wave = sin(coord.x * params.frequency + params.phase) * params.amplitude;

  // Color based on wave and y coordinate
  let r = (sin(wave + coord.y + params.colorShift) + 1.0) * 0.5;
  let g = (sin(wave + coord.y + params.colorShift + 2.094) + 1.0) * 0.5;
  let b = (sin(wave + coord.y + params.colorShift + 4.189) + 1.0) * 0.5;

  output[index] = vec4<f32>(r, g, b, 1.0);
}
