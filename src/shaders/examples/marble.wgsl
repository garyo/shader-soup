// Marble Texture
// Realistic marble with directional veining and warm stone tones

struct Dimensions {
  width: u32,
  height: u32,
  zoom: f32,
  _pad1: u32,
  panX: f32,
  panY: f32,
  time: f32,
  frame: u32,
}

struct Params {
  scale: f32,             // min=1.0, max=20.0, default=6.0, step=0.5
  turbulenceAmount: f32,  // min=0.0, max=10.0, default=4.0, step=0.5
  veiningSharpness: f32,  // min=1.0, max=10.0, default=3.0, step=0.5
  veiningDensity: f32,    // min=1.0, max=30.0, default=12.0, step=1.0
  warmth: f32,            // min=0.0, max=1.0, default=0.3, step=0.05
  veinDarkness: f32,      // min=0.0, max=1.0, default=0.25, step=0.05
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

  let coord = get_uv(
    id.xy,
    dimensions.width,
    dimensions.height,
    vec2<f32>(dimensions.panX, dimensions.panY),
    dimensions.zoom
  );

  let p = coord * params.scale + vec2f(dimensions.time * 0.08, 0.0);

  // Turbulence for vein distortion
  let turb = turbulence(p * 0.8, 5);

  // Primary veining: sine along one axis, distorted by turbulence
  let veinPattern = sin(p.x * params.veiningDensity + turb * params.turbulenceAmount);

  // Sharpen veins using power function — creates thin dark lines in light stone
  let veinRaw = (veinPattern + 1.0) * 0.5; // [0, 1]
  let vein = pow(veinRaw, params.veiningSharpness);

  // Secondary fine veins at a different angle
  let turb2 = turbulence(p * 1.5 + vec2f(7.3, 2.1), 4);
  let fineVein = sin(p.x * 0.7 * params.veiningDensity + p.y * 0.5 * params.veiningDensity + turb2 * 2.5);
  let fineVeinSharp = pow((fineVein + 1.0) * 0.5, params.veiningSharpness * 1.5);

  // Combine: primary veins dominate, fine veins add detail
  let combinedVein = min(vein, mix(1.0, fineVeinSharp, 0.4));

  // Base stone color: warm white/cream
  let stoneLight = vec3<f32>(0.95, 0.93, 0.88);
  let stoneMid = vec3<f32>(0.85, 0.82, 0.76);

  // Subtle variation in the stone body using low-frequency noise
  let bodyNoise = (fbmPerlin(p * 0.5 + vec2f(3.7, 1.2)) + 1.0) * 0.5;
  let stoneBase = mix(stoneLight, stoneMid, bodyNoise * 0.5);

  // Vein color: dark gray-brown
  let veinColor = vec3<f32>(
    params.veinDarkness * 0.9,
    params.veinDarkness * 0.85,
    params.veinDarkness * 0.75
  );

  // Mix stone and veins
  var color = mix(veinColor, stoneBase, combinedVein);

  // Add warmth (subtle golden tint)
  let warmTint = vec3<f32>(1.0, 0.95, 0.85);
  color = mix(color, color * warmTint, params.warmth);

  // Optional color shift for colored marble varieties
  if (params.colorShift > 0.01) {
    let tint = vec3<f32>(
      sin(params.colorShift) * 0.08,
      sin(params.colorShift + 2.094) * 0.08,
      sin(params.colorShift + 4.189) * 0.08
    );
    color = clamp(color + tint, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(color, 1.0));
}
