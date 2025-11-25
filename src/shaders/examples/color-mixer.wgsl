// Color Mixer
// Generates gradient patterns with adjustable RGB color mixing


struct Dimensions {
  width: u32,
  height: u32, _pad1: u32, _pad2: u32
}

struct Params {
  redIntensity: f32,  // min=0.0, max=1.0, default=0.5, step=0.01
  greenIntensity: f32,  // min=0.0, max=1.0, default=0.5, step=0.01
  blueIntensity: f32,  // min=0.0, max=1.0, default=0.5, step=0.01
  mixMode: f32,  // min=0.0, max=3.0, default=0.0, step=1.0
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
