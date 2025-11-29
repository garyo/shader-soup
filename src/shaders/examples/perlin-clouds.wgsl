// Perlin Clouds
// Demonstrates Perlin noise and FBM for cloud-like patterns

struct Dimensions {
  width: u32,
  height: u32,
}

struct Params {
  scale: f32,       // min=1.0, max=20.0, default=5.0, step=0.5
  octaves: f32,     // min=1.0, max=8.0, default=4.0, step=1.0
  lacunarity: f32,  // min=1.5, max=3.0, default=2.0, step=0.1
  gain: f32,        // min=0.1, max=0.9, default=0.5, step=0.05
  warpAmount: f32,  // min=0.0, max=2.0, default=0.3, step=0.1
  brightness: f32,  // min=0.0, max=2.0, default=1.0, step=0.1
  contrast: f32,    // min=0.5, max=2.0, default=1.2, step=0.1
}

@group(0) @binding(0) var coordTexture: texture_2d<f32>;
@group(0) @binding(1) var coordSampler: sampler;
@group(0) @binding(2) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  //   let index = id.y * dimensions.width + id.x; // Removed for texture output

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

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(color, 1.0));
}
