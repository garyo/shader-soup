// Cellular Pattern
// Voronoi-like cellular noise for organic patterns


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
  scale: f32,  // min=1.0, max=30.0, default=10.0, step=1.0
  edgeThickness: f32,  // min=0.0, max=0.5, default=0.05, step=0.01
  invert: f32,  // min=0.0, max=1.0, default=0.0, step=1.0
  colorVariation: f32,  // min=0.0, max=1.0, default=0.5, step=0.1
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
  let fillColor = hsv_to_rgb(hue, params.colorVariation, 0.8 + cellHash * 0.2);

  let color = mix(edgeColor, fillColor, edgeFactor);

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(color, 1.0));
}
