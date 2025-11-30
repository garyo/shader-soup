// Marble Texture
// Uses turbulence and domain warping for marble-like patterns

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
  scale: f32,             // min=1.0, max=20.0, default=8.0, step=0.5
  turbulenceAmount: f32,  // min=0.0, max=10.0, default=5.0, step=0.5
  veiningScale: f32,      // min=1.0, max=50.0, default=15.0, step=1.0
  warpAmount: f32,        // min=0.0, max=3.0, default=1.0, step=0.1
  darkColor: f32,         // min=0.0, max=1.0, default=0.2, step=0.05
  lightColor: f32,        // min=0.0, max=1.0, default=0.9, step=0.05
  colorShift: f32,        // min=0.0, max=6.28, default=0.0, step=0.1
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
  var p = coord * params.scale;

  // Apply domain warping
  if (params.warpAmount > 0.0) {
    p = domainWarp(p, params.warpAmount);
  }

  // Create base marble pattern using sine wave + turbulence
  let turbValue = turbulence(p * params.veiningScale, 6);
  let marble = sin(p.x + turbValue * params.turbulenceAmount);

  // Remap to [0, 1]
  var value = (marble + 1.0) * 0.5;
  value = clamp(value, 0.0, 1.0);

  // Create color variation
  let baseColor = mix(
    vec3<f32>(params.darkColor, params.darkColor * 0.9, params.darkColor * 0.8),
    vec3<f32>(params.lightColor, params.lightColor * 0.95, params.lightColor * 0.9),
    value
  );

  // Add subtle color shift
  let colorOffset = vec3<f32>(
    sin(params.colorShift) * 0.1,
    sin(params.colorShift + 2.094) * 0.1,
    sin(params.colorShift + 4.189) * 0.1
  );

  let finalColor = clamp(baseColor + colorOffset, vec3<f32>(0.0), vec3<f32>(1.0));

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(finalColor, 1.0));
}
