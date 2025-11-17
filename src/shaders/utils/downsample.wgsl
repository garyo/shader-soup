// GPU-based downsampling with box filter
// Downsamples an image by averaging NxN pixel blocks

struct DownsampleParams {
  source_width: u32,
  source_height: u32,
  result_width: u32,
  result_height: u32,
  factor: u32,
}

@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: DownsampleParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // Result pixel position
  let tx = id.x;
  let ty = id.y;

  if (tx >= params.result_width || ty >= params.result_height) {
    return;
  }

  // Average the factor x factor block from source
  var color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let pixels_per_block = f32(params.factor * params.factor);

  for (var dy = 0u; dy < params.factor; dy++) {
    for (var dx = 0u; dx < params.factor; dx++) {
      let sx = tx * params.factor + dx;
      let sy = ty * params.factor + dy;
      let si = sy * params.source_width + sx;

      color += source[si];
    }
  }

  // Write averaged color to result
  let ti = ty * params.result_width + tx;
  result[ti] = color / pixels_per_block;
}
