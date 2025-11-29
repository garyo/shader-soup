// Convert rgba16float texture to vec4<f32> buffer
// Needed for compatibility with post-processing pipeline

@group(0) @binding(0) var inputTexture: texture_2d<f32>;  // rgba16float source
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<vec4<f32>>;  // Float32 buffer

@group(0) @binding(2) var<uniform> dimensions: vec2<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= dimensions.x || id.y >= dimensions.y) {
    return;
  }

  let index = id.y * dimensions.x + id.x;

  // Load from texture and store to buffer (automatic conversion to f32)
  let color = textureLoad(inputTexture, vec2<i32>(id.xy), 0);
  outputBuffer[index] = color;
}
