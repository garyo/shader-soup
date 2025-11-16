// Checkerboard Pattern
// Creates a customizable checkerboard pattern

// @param scale: 1.0, 50.0, 10.0, 1.0
// @param rotation: 0.0, 6.28, 0.0, 0.1
// @param color1Red: 0.0, 1.0, 0.0, 0.01
// @param color2Red: 0.0, 1.0, 1.0, 0.01

struct Params {
  scale: f32,
  rotation: f32,
  color1Red: f32,
  color2Red: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = 512u;
  let height = 512u;

  if (id.x >= width || id.y >= height) {
    return;
  }

  let index = id.y * width + id.x;
  let coord = coords[index];

  // Apply rotation
  let cosRot = cos(params.rotation);
  let sinRot = sin(params.rotation);
  let rotated = vec2<f32>(
    coord.x * cosRot - coord.y * sinRot,
    coord.x * sinRot + coord.y * cosRot
  );

  // Scale coordinates
  let scaled = rotated * params.scale;

  // Create checkerboard
  let checker = floor(scaled.x) + floor(scaled.y);
  let isEven = fract(checker * 0.5) < 0.1;

  var color: vec3<f32>;
  if (isEven) {
    color = vec3<f32>(params.color1Red, params.color1Red, params.color1Red);
  } else {
    color = vec3<f32>(params.color2Red, params.color2Red, params.color2Red);
  }

  output[index] = vec4<f32>(color, 1.0);
}
