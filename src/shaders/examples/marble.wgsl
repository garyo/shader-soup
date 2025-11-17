// Marble Texture
// Uses turbulence and domain warping for marble-like patterns

// @param scale: 1.0, 20.0, 8.0, 0.5
// @param turbulenceAmount: 0.0, 10.0, 5.0, 0.5
// @param veiningScale: 1.0, 50.0, 15.0, 1.0
// @param warpAmount: 0.0, 3.0, 1.0, 0.1
// @param darkColor: 0.0, 1.0, 0.2, 0.05
// @param lightColor: 0.0, 1.0, 0.9, 0.05
// @param colorShift: 0.0, 6.28, 0.0, 0.1

struct Dimensions {
  width: u32,
  height: u32,
}

struct Params {
  scale: f32,
  turbulenceAmount: f32,
  veiningScale: f32,
  warpAmount: f32,
  darkColor: f32,
  lightColor: f32,
  colorShift: f32,
}

@group(0) @binding(0) var<storage, read> coords: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> dimensions: Dimensions;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  let index = id.y * dimensions.width + id.x;
  let coord = coords[index];

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

  output[index] = vec4<f32>(finalColor, 1.0);
}
