// Tone Mapping Shader
// Converts rgba32float HDR texture to canvas display format (rgba8unorm/bgra8unorm)
// Simple linear tone mapping for now, can be enhanced with better tone mapping curves

@group(0) @binding(0) var inputTexture: texture_2d<f32>;  // rgba32float source
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;  // Canvas format

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(inputTexture);

  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  // Load HDR color
  let hdrColor = textureLoad(inputTexture, vec2<i32>(id.xy), 0);

  // Simple linear tone mapping (clamp to [0,1])
  // TODO: Add proper tone mapping operators (Reinhard, ACES, etc.) for HDR display
  let ldrColor = saturate_v4(hdrColor);

  // Store to output
  textureStore(outputTexture, vec2<u32>(id.xy), ldrColor);
}
