// Checkerboard Pattern
// Creates a customizable checkerboard pattern


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
  scale: f32,  // min=1.0, max=50.0, default=10.0, step=1.0
  rotation: f32,  // min=0.0, max=6.28, default=0.0, step=0.1
  color1Red: f32,  // min=0.0, max=1.0, default=0.0, step=0.01
  color2Red: f32,  // min=0.0, max=1.0, default=1.0, step=0.01
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

  // Apply rotation
  let angle = params.rotation + dimensions.time * 0.5;
  let cosRot = cos(angle);
  let sinRot = sin(angle);
  let rotated = vec2<f32>(
    coord.x * cosRot - coord.y * sinRot,
    coord.x * sinRot + coord.y * cosRot
  );

  // Scale coordinates
  let scaled = rotated * params.scale;

  // Create checkerboard
  let checker = floor(scaled.x) + floor(scaled.y);
  let isEven = fract(checker * 0.5) < 0.1;

  var color: vec3<f32>;
  if (isEven) {
    color = vec3<f32>(params.color1Red, params.color1Red, params.color1Red);
  } else {
    color = vec3<f32>(params.color2Red, params.color2Red, params.color2Red);
  }

  // Write to HDR texture using textureStore
  textureStore(output, vec2<u32>(id.xy), vec4<f32>(color, 1.0));
}
