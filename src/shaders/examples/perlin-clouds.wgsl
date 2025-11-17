// Perlin Clouds
// Demonstrates Perlin noise and FBM for cloud-like patterns

// @param scale: 1.0, 20.0, 5.0, 0.5
// @param octaves: 1.0, 8.0, 4.0, 1.0
// @param lacunarity: 1.5, 3.0, 2.0, 0.1
// @param gain: 0.1, 0.9, 0.5, 0.05
// @param warpAmount: 0.0, 2.0, 0.3, 0.1
// @param brightness: 0.0, 2.0, 1.0, 0.1
// @param contrast: 0.5, 2.0, 1.2, 0.1

struct Dimensions {
  width: u32,
  height: u32,
}

struct Params {
  scale: f32,
  octaves: f32,
  lacunarity: f32,
  gain: f32,
  warpAmount: f32,
  brightness: f32,
  contrast: f32,
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

  // Scale coordinates
  var p = coord * params.scale;

  // Apply domain warping for more organic shapes
  if (params.warpAmount > 0.0) {
    p = domainWarp(p, params.warpAmount);
  }

  // Generate fractal noise
  let noise = fbmPerlinCustom(
    p,
    i32(params.octaves),
    params.lacunarity,
    params.gain
  );

  // Adjust brightness and contrast
  var value = (noise + 1.0) * 0.5;  // Remap from [-1,1] to [0,1]
  value = (value - 0.5) * params.contrast + 0.5;
  value = value * params.brightness;
  value = clamp(value, 0.0, 1.0);

  // Create cloud-like coloring (white to blue gradient)
  let skyBlue = vec3<f32>(0.5, 0.7, 1.0);
  let white = vec3<f32>(1.0, 1.0, 1.0);
  let color = mix(skyBlue, white, value);

  output[index] = vec4<f32>(color, 1.0);
}
