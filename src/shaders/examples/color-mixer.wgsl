// Color Mixer
// Generates gradient patterns with adjustable RGB color mixing

// @param redIntensity: 0.0, 1.0, 0.5, 0.01
// @param greenIntensity: 0.0, 1.0, 0.5, 0.01
// @param blueIntensity: 0.0, 1.0, 0.5, 0.01
// @param mixMode: 0.0, 3.0, 0.0, 1.0

struct Params {
  redIntensity: f32,
  greenIntensity: f32,
  blueIntensity: f32,
  mixMode: f32,
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

  var r: f32;
  var g: f32;
  var b: f32;

  // Mix mode 0: Linear gradient
  if (params.mixMode < 0.5) {
    r = (coord.x + 1.0) * 0.5 * params.redIntensity;
    g = (coord.y + 1.0) * 0.5 * params.greenIntensity;
    b = (1.0 - (coord.x + 1.0) * 0.5) * params.blueIntensity;
  }
  // Mix mode 1: Radial gradient
  else if (params.mixMode < 1.5) {
    let dist = length(coord);
    r = (1.0 - dist) * params.redIntensity;
    g = dist * params.greenIntensity;
    b = (1.0 - abs(coord.x)) * params.blueIntensity;
  }
  // Mix mode 2: Angular gradient
  else if (params.mixMode < 2.5) {
    let angle = atan2(coord.y, coord.x);
    r = (sin(angle) * 0.5 + 0.5) * params.redIntensity;
    g = (cos(angle) * 0.5 + 0.5) * params.greenIntensity;
    b = (sin(angle * 2.0) * 0.5 + 0.5) * params.blueIntensity;
  }
  // Mix mode 3: Checkerboard
  else {
    let checker = floor(coord.x * 10.0) + floor(coord.y * 10.0);
    let isEven = fract(checker * 0.5) < 0.1;
    if (isEven) {
      r = params.redIntensity;
      g = params.greenIntensity;
      b = params.blueIntensity;
    } else {
      r = 1.0 - params.redIntensity;
      g = 1.0 - params.greenIntensity;
      b = 1.0 - params.blueIntensity;
    }
  }

  output[index] = vec4<f32>(r, g, b, 1.0);
}
