// Radial Gradient
// Creates a radial gradient from center with color controls

// @param innerRadius: 0.0, 2.0, 0.0, 0.05
// @param outerRadius: 0.0, 2.0, 1.0, 0.05
// @param centerX: -1.0, 1.0, 0.0, 0.05
// @param centerY: -1.0, 1.0, 0.0, 0.05
// @param hueShift: 0.0, 6.28, 0.0, 0.1

struct Params {
  innerRadius: f32,
  outerRadius: f32,
  centerX: f32,
  centerY: f32,
  hueShift: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

// HSV to RGB conversion
fn hsvToRgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let x = c * (1.0 - abs((h / 1.047197551) % 2.0 - 1.0));
  let m = v - c;

  var rgb: vec3<f32>;
  let h60 = h / 1.047197551;

  if (h60 < 1.0) {
    rgb = vec3<f32>(c, x, 0.0);
  } else if (h60 < 2.0) {
    rgb = vec3<f32>(x, c, 0.0);
  } else if (h60 < 3.0) {
    rgb = vec3<f32>(0.0, c, x);
  } else if (h60 < 4.0) {
    rgb = vec3<f32>(0.0, x, c);
  } else if (h60 < 5.0) {
    rgb = vec3<f32>(x, 0.0, c);
  } else {
    rgb = vec3<f32>(c, 0.0, x);
  }

  return rgb + m;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = 512u;
  let height = 512u;

  if (id.x >= width || id.y >= height) {
    return;
  }

  let index = id.y * width + id.x;
  let coord = coords[index];

  // Calculate distance from center
  let center = vec2<f32>(params.centerX, params.centerY);
  let dist = length(coord - center);

  // Calculate gradient value
  let gradientValue = smoothstep(params.innerRadius, params.outerRadius, dist);

  // Create color based on distance and hue shift
  let hue = (dist + params.hueShift) % 6.28;
  let saturation = 1.0 - gradientValue;
  let value = 1.0;

  let color = hsvToRgb(hue, saturation, value);

  output[index] = vec4<f32>(color, 1.0);
}
