// Polygon Shapes - showcases 2D signed distance functions
// Renders layered polygon shapes with smooth blending and colorful fills
// Shapes gently orbit and rotate over time

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
  shapeSize: f32,    // min=0.1, max=1.0, default=0.4, step=0.05
  blend: f32,        // min=0.0, max=0.3, default=0.08, step=0.01
  colorShift: f32,   // min=0.0, max=6.28, default=0.0, step=0.1
  starPoints: f32,   // min=3.0, max=8.0, default=5.0, step=1.0
}

@group(0) @binding(0) var output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> dimensions: Dimensions;
@group(0) @binding(2) var<uniform> params: Params;

// 2D rotation
fn rot2(a: f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, s, -s, c);
}

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

  let t = dimensions.time * 0.3;
  let r = params.shapeSize;
  let k = params.blend;

  // Central shapes: rotate slowly in place
  let centerCoord = rot2(t * 0.5) * coord;
  let dHex = sdHexagon(centerCoord, r);
  let dStar = sdStar(centerCoord, r * 0.55, i32(params.starPoints), 2.5);

  // Outer shapes orbit slowly around the center
  let orbitR = 0.85;
  let triPos = vec2f(cos(t), sin(t)) * orbitR;
  let pentPos = vec2f(cos(t + 2.094), sin(t + 2.094)) * orbitR;
  let octPos = vec2f(cos(t + 4.189), sin(t + 4.189)) * orbitR;
  let hexSmallPos = vec2f(cos(t + 5.236), sin(t + 5.236)) * orbitR;

  // Each outer shape rotates around its own center too
  let dTri = sdEquilateralTriangle(rot2(-t * 1.2) * (coord - triPos), r * 0.25);
  let dPent = sdPentagon(rot2(t * 0.8) * (coord - pentPos), r * 0.22);
  let dOct = sdOctagon(rot2(-t * 0.6) * (coord - octPos), r * 0.2);
  let dHexSmall = sdHexagram(rot2(t * 1.0) * (coord - hexSmallPos), r * 0.18);

  // Central composition: star inside hexagon (smooth intersection via smooth_max)
  let dCenter = smooth_max(dHex, dStar, k);

  // Combine outer shapes with smooth union
  var dOuter = smooth_min(dTri, dPent, k);
  dOuter = smooth_min(dOuter, dOct, k);
  dOuter = smooth_min(dOuter, dHexSmall, k);

  // Smooth union of center piece and outer shapes
  var d = smooth_min(dCenter, dOuter, k);

  // Color: hue varies by shape proximity
  let w0 = 1.0 / (abs(dHex)     + 0.02);
  let w1 = 1.0 / (abs(dStar)    + 0.02);
  let w2 = 1.0 / (abs(dTri)     + 0.02);
  let w3 = 1.0 / (abs(dPent)    + 0.02);
  let w4 = 1.0 / (abs(dOct)     + 0.02);
  let w5 = 1.0 / (abs(dHexSmall) + 0.02);
  let totalW = w0 + w1 + w2 + w3 + w4 + w5;
  let hue = (w0 * 0.5 + w1 * 1.0 + w2 * 2.0 + w3 * 3.2 + w4 * 4.5 + w5 * 5.5) / totalW + params.colorShift + t * 0.5;

  // Inside: saturated color. Outside: dark with glow. Edges highlighted.
  let inside = smoothstep(0.01, -0.01, d);
  let glow = exp(-8.0 * max(d, 0.0));
  let ew = 0.004 + k * 0.5; // edge width grows with blend
  let edge = 1.0 - smoothstep(-ew, ew, abs(d));

  // Also highlight the star outline inside the hexagon
  let starEdge = 1.0 - smoothstep(-ew, ew, abs(dStar));
  let hexEdge = 1.0 - smoothstep(-ew, ew, abs(dHex));

  // In the ring between star and hex (star > 0, hex < 0): red-to-purple ramp
  let inRing = step(0.0, dStar) * step(dHex, 0.0);
  let ringT = saturate_f32(dStar / (dStar - dHex + 0.001));
  let ringCol = mix(vec3f(0.9, 0.1, 0.1), vec3f(0.6, 0.1, 0.9), ringT);

  let baseCol = hsv_to_rgb(hue, 0.75 + 0.25 * inside, 0.1 + 0.8 * inside + 0.25 * glow);
  let col = mix(baseCol, ringCol, inRing);
  let final_col = col + vec3f((edge + starEdge * 0.4 + hexEdge * 0.3) * 0.5);

  textureStore(output, vec2<u32>(id.xy), vec4<f32>(final_col, 1.0));
}
