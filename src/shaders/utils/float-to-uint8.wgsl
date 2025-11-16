/**
 * Float32 to Uint8 Conversion Shader
 * Converts vec4<f32> (16 bytes/pixel) to packed RGBA8 format (4 bytes/pixel)
 * This reduces memory transfer and eliminates CPU conversion overhead
 */

@group(0) @binding(0) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

fn pack_rgba8(color: vec4<f32>) -> u32 {
  // Clamp to [0.0, 1.0] and convert to [0, 255]
  let r = u32(clamp(color.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(color.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(color.b, 0.0, 1.0) * 255.0);
  let a = u32(clamp(color.a, 0.0, 1.0) * 255.0);

  // Pack into single u32: RGBA order (little-endian)
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check
  if (index >= arrayLength(&input)) {
    return;
  }

  // Convert and pack
  output[index] = pack_rgba8(input[index]);
}
