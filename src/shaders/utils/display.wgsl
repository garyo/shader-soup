// Display shader - Renders mipmapped post-processed texture to canvas
// Input: rgba16float with mipmaps (filterable, tier2) or rgba32float (unfilterable, fallback)
// Uses trilinear filtering for smooth 3x supersampled downsampling (automatic mip level selection)

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;  // Post-processed texture
@group(0) @binding(1) var sourceSampler: sampler;          // Linear sampler for downsampling

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

// Fullscreen triangle vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate fullscreen triangle
  let x = f32((vertexIndex << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vertexIndex & 2u) * 2.0 - 1.0;

  output.position = vec4<f32>(x, -y, 0.0, 1.0);  // Flip Y for texture coords
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  return output;
}

// Fragment shader - samples from mipmapped texture with automatic LOD selection
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Sample with trilinear filtering (automatically selects correct mip level)
  // For 1536→512 (3x downsample), GPU picks mip level ~1.58 and interpolates
  // This gives proper antialiasing from the 3x supersampled render
  let color = textureSample(sourceTexture, sourceSampler, input.uv);

  // Clamp to valid range for display
  return clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
}
