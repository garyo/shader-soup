// GPU-based Gamma and Contrast Post-Processing
// Input: rgba32float from compute shader (high precision)
// Output: rgba16float for display (filterable, HDR) when tier2 available, else rgba32float

@group(0) @binding(0) var inputTexture: texture_2d<f32>;        // rgba32float input (unfilterable)
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba16float, write>;  // rgba16float output (format replaced at runtime)
@group(0) @binding(2) var<uniform> dimensions: vec2<u32>;
@group(0) @binding(3) var<uniform> params: vec2<f32>; // x=gamma, y=contrast

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.x || id.y >= dimensions.y) {
    return;
  }

  // Load HDR color
  let color = textureLoad(inputTexture, vec2<i32>(id.xy), 0);

  // Extract RGB and alpha
  var rgb = color.rgb;
  let alpha = color.a;

  // Apply contrast (centered at 0.5, where params.y=0 means no change)
  let contrastFactor = 1.0 + params.y;  // params.y: -1 to 1, default 0
  rgb = (rgb - 0.5) * contrastFactor + 0.5;

  // Apply gamma correction (where params.x=1.0 means no change)
  let gamma = params.x;
  rgb = pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / gamma));

  // Clamp to valid range
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  // Write result
  textureStore(outputTexture, vec2<u32>(id.xy), vec4<f32>(rgb, alpha));
}
