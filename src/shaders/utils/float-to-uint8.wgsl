/**
 * Float32 to Uint8 Conversion Shader with sRGB conversion
 * Converts vec4<f32> (16 bytes/pixel, linear RGB) to packed RGBA8 format (4 bytes/pixel, sRGB)
 * This reduces memory transfer and eliminates CPU conversion overhead
 */

@group(0) @binding(0) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

// Convert linear RGB to sRGB
// See: https://en.wikipedia.org/wiki/SRGB#Specification_of_the_transformation
fn linear_to_srgb(linear: f32) -> f32 {
  if (linear <= 0.0031308) {
    return 12.92 * linear;
  } else {
    return 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
  }
}

fn pack_rgba8(color: vec4<f32>) -> u32 {
  // Convert from linear RGB to sRGB for display
  let srgb = vec4<f32>(
    linear_to_srgb(color.r),
    linear_to_srgb(color.g),
    linear_to_srgb(color.b),
    color.a  // Alpha remains linear
  );

  // Clamp to [0.0, 1.0] and convert to [0, 255]
  let r = u32(clamp(srgb.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(srgb.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(srgb.b, 0.0, 1.0) * 255.0);
  let a = u32(clamp(srgb.a, 0.0, 1.0) * 255.0);

  // Pack into single u32: RGBA order (little-endian)
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

@compute @workgroup_size(8, 8)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(num_workgroups) num_workgroups: vec3<u32>
) {
  // Calculate 1D index from 2D coordinates
  // Assuming width = num_workgroups.x * 8
  let width = num_workgroups.x * 8u;
  let index = id.y * width + id.x;

  // Bounds check
  if (index >= arrayLength(&input)) {
    return;
  }

  // Convert and pack
  output[index] = pack_rgba8(input[index]);
}
