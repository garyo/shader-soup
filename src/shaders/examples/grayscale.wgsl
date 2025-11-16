// Grayscale Image Filter
// Converts input image to grayscale with adjustable intensity

// @param intensity: 0.0, 1.0, 1.0, 0.01
// @param contrast: 0.5, 2.0, 1.0, 0.05
// @param brightness: -0.5, 0.5, 0.0, 0.01

struct Params {
  intensity: f32,
  contrast: f32,
  brightness: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var inputTexture: texture_2d<f32>;
@group(0) @binding(4) var inputSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = 512u;
  let height = 512u;

  if (id.x >= width || id.y >= height) {
    return;
  }

  let index = id.y * width + id.x;
  let coord = coords[index];

  // Convert normalized coords (-1 to 1) to texture coords (0 to 1)
  let texCoord = vec2<f32>(
    (coord.x + 1.0) * 0.5,
    (coord.y + 1.0) * 0.5
  );

  // Sample texture
  let color = textureSampleLevel(inputTexture, inputSampler, texCoord, 0.0);

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

  output[index] = vec4<f32>(result, color.a);
}
