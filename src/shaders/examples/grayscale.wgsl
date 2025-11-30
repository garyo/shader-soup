// Grayscale Image Filter
// Converts input image to grayscale with adjustable intensity


struct Dimensions {
  width: u32,
  height: u32,
  zoom: f32,
  _pad1: u32,
  panX: f32,
  panY: f32,
  _pad2: u32,
  _pad3: u32,
}

struct Params {
  intensity: f32,  // min=0.0, max=1.0, default=1.0, step=0.01
  contrast: f32,  // min=0.5, max=2.0, default=1.0, step=0.05
  brightness: f32,  // min=-0.5, max=0.5, default=0.0, step=0.01
}

@group(0) @binding(0) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> dimensions: Dimensions;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var inputTexture: texture_2d<f32>;
@group(0) @binding(4) var inputSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  // Get normalized UV coordinates using helper function
  let coord = get_uv(
    id.xy,
    dimensions.width,
    dimensions.height,
    vec2<f32>(dimensions.panX, dimensions.panY),
    dimensions.zoom
  );

  // Convert normalized coords (-1 to 1) to texture coords (0 to 1)
  let inputTexCoord = vec2<f32>(
    (coord.x + 1.0) * 0.5,
    (coord.y + 1.0) * 0.5
  );

  // Sample texture
  let color = textureSampleLevel(inputTexture, inputSampler, inputTexCoord, 0.0);

  // Calculate grayscale using luminance formula
  let gray = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));

  // Mix between original and grayscale based on intensity
  var result = mix(color.rgb, vec3<f32>(gray), params.intensity);

  // Apply contrast
  result = (result - 0.5) * params.contrast + 0.5;

  // Apply brightness
  result = result + params.brightness;

  // Clamp to valid range
  result = clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(result, color.a));
}
