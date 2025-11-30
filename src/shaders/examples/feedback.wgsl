// Feedback Loop Example - Diffusion with decay
// @iterations 10

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
  decay: f32,  // min=0.9, max=1.0, default=0.98, step=0.01
  diffusion: f32,  // min=0.0, max=0.5, default=0.15, step=0.01
  inject: f32,  // min=0.0, max=0.5, default=0.05, step=0.01
}

@group(0) @binding(0) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> dimensions: Dimensions;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var prevFrame: texture_2d<f32>;
@group(0) @binding(4) var prevSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.width || id.y >= dimensions.height) {
    return;
  }

  // Get normalized texture coordinates for prevFrame sampling
  let texCoord = vec2<f32>(
    f32(id.x) / f32(dimensions.width),
    f32(id.y) / f32(dimensions.height)
  );

  // Get normalized UV coordinates using helper function
  let coord = get_uv(
    id.xy,
    dimensions.width,
    dimensions.height,
    vec2<f32>(dimensions.panX, dimensions.panY),
    dimensions.zoom
  );

  // Sample previous frame (if exists, otherwise will be black/zero)
  let prev = textureSampleLevel(prevFrame, prevSampler, texCoord, 0.0);

  // Sample neighbors for diffusion
  let offset = 1.0 / f32(dimensions.width);
  let left = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2<f32>(-offset, 0.0), 0.0);
  let right = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2<f32>(offset, 0.0), 0.0);
  let up = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2<f32>(0.0, -offset), 0.0);
  let down = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2<f32>(0.0, offset), 0.0);

  // Diffuse: average with neighbors
  let diffused = (prev + left + right + up + down) * 0.2;

  // Decay over time
  var current = mix(prev, diffused, params.diffusion) * params.decay;

  // Inject new "energy" at certain locations (circular pattern)
  let dist = length(coord);
  let angle = atan2(coord.y, coord.x);

  // Create rotating injection points
  let injectionAmount = params.inject * smoothstep(0.3, 0.2, abs(dist - 0.5 - sin(angle * 5.0) * 0.1));

  current = current + vec4<f32>(
    injectionAmount * (0.5 + 0.5 * sin(angle * 2.0)),
    injectionAmount * (0.5 + 0.5 * cos(angle * 3.0)),
    injectionAmount * (0.5 + 0.5 * sin(angle * 5.0)),
    1.0
  );

  textureStore(output, vec2<u32>(id.xy), clamp(current, vec4<f32>(0.0), vec4<f32>(1.0)));
}
