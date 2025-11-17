// Cellular Pattern
// Voronoi-like cellular noise for organic patterns

// @param scale: 1.0, 30.0, 10.0, 1.0
// @param edgeThickness: 0.0, 0.5, 0.05, 0.01
// @param invert: 0.0, 1.0, 0.0, 1.0
// @param colorVariation: 0.0, 1.0, 0.5, 0.1
// @param hueShift: 0.0, 6.28, 0.0, 0.1

struct Dimensions {
  width: u32,
  height: u32,
}

struct Params {
  scale: f32,
  edgeThickness: f32,
  invert: f32,
  colorVariation: f32,
  hueShift: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> dimensions: Dimensions;
@group(0) @binding(3) var<uniform> params: Params;

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
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  let index = id.y * dimensions.width + id.x;
  let coord = coords[index];

  // Scale coordinates
  let p = coord * params.scale;

  // Get cellular noise value
  var cellValue = cellularNoise(p);

  // Invert if requested
  if (params.invert > 0.5) {
    cellValue = 1.0 - cellValue;
  }

  // Create edge highlighting
  let edgeFactor = smoothstep(params.edgeThickness, params.edgeThickness + 0.05, cellValue);

  // Add color variation based on cell position
  let cellId = floor(p);
  let cellHash = hash21(cellId);
  let hue = (cellHash + params.hueShift) % 6.28;

  // Mix between edge color and fill color
  let edgeColor = vec3<f32>(0.0, 0.0, 0.0);
  let fillColor = hsvToRgb(hue, params.colorVariation, 0.8 + cellHash * 0.2);

  let color = mix(edgeColor, fillColor, edgeFactor);

  output[index] = vec4<f32>(color, 1.0);
}
