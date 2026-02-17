// Feedback Loop Example - Diffusion trails with time-driven injection
// No @iterations — uses inter-frame feedback only (one pass per frame, fast)

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
  decay: f32,  // min=0.9, max=1.0, default=0.97, step=0.005
  spread: f32,  // min=0.0, max=0.5, default=0.2, step=0.01
  inject: f32,  // min=0.0, max=1.0, default=0.4, step=0.01
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

  let texCoord = vec2<f32>(
    f32(id.x) / f32(dimensions.width),
    f32(id.y) / f32(dimensions.height)
  );

  let coord = get_uv(
    id.xy,
    dimensions.width,
    dimensions.height,
    vec2<f32>(dimensions.panX, dimensions.panY),
    dimensions.zoom
  );

  let t = dimensions.time;

  // Sample previous frame center + neighbors for diffusion
  let prev = textureSampleLevel(prevFrame, prevSampler, texCoord, 0.0);
  let px = 1.0 / f32(dimensions.width);
  let py = 1.0 / f32(dimensions.height);
  let left  = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2f(-px, 0.0), 0.0);
  let right = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2f( px, 0.0), 0.0);
  let up    = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2f(0.0, -py), 0.0);
  let down  = textureSampleLevel(prevFrame, prevSampler, texCoord + vec2f(0.0,  py), 0.0);

  // Diffuse and decay
  let neighbors = (left + right + up + down) * 0.25;
  var current = mix(prev, neighbors, params.spread) * params.decay;

  // Time-driven injection: rotating emitters that move and change color
  let angle = atan2(coord.y, coord.x);
  let dist = length(coord);

  // Three orbiting emitters at different speeds
  let e1 = vec2f(cos(t * 1.3) * 0.4, sin(t * 1.7) * 0.4);
  let e2 = vec2f(cos(t * 0.9 + 2.1) * 0.5, sin(t * 1.1 + 2.1) * 0.3);
  let e3 = vec2f(cos(t * 0.7 + 4.2) * 0.3, sin(t * 1.5 + 4.2) * 0.5);

  let d1 = smoothstep(0.12, 0.0, length(coord - e1));
  let d2 = smoothstep(0.10, 0.0, length(coord - e2));
  let d3 = smoothstep(0.08, 0.0, length(coord - e3));

  // Each emitter injects a different hue that shifts over time
  let c1 = hsv_to_rgb(t * 0.5, 0.9, 1.0) * d1;
  let c2 = hsv_to_rgb(t * 0.3 + 2.0, 0.85, 1.0) * d2;
  let c3 = hsv_to_rgb(t * 0.7 + 4.0, 0.95, 1.0) * d3;

  let injection = (c1 + c2 + c3) * params.inject;
  current = vec4f(current.rgb + injection, 1.0);

  textureStore(output, vec2<u32>(id.xy), clamp(current, vec4f(0.0), vec4f(1.0)));
}
