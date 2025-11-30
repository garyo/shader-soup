// Radial Gradient
// Creates a radial gradient from center with color controls


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
  innerRadius: f32,  // min=0.0, max=2.0, default=0.0, step=0.05
  outerRadius: f32,  // min=0.0, max=2.0, default=1.0, step=0.05
  centerX: f32,  // min=-1.0, max=1.0, default=0.0, step=0.05
  centerY: f32,  // min=-1.0, max=1.0, default=0.0, step=0.05
  hueShift: f32,  // min=0.0, max=6.28, default=0.0, step=0.1
}

@group(0) @binding(0) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> dimensions: Dimensions;
@group(0) @binding(2) var<uniform> params: Params;

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

  // Calculate distance from center
  let center = vec2<f32>(params.centerX, params.centerY);
  let dist = length(coord - center);

  // Calculate gradient value
  let gradientValue = smoothstep(params.innerRadius, params.outerRadius, dist);

  // Create color based on distance and hue shift
  let hue = (dist + params.hueShift) % 6.28;
  let saturation = 1.0 - gradientValue;
  let value = 1.0;

  let color = hsv_to_rgb(hue, saturation, value);

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(color, 1.0));
}
