// Mipmap generation shader - blits from source mip level to dest mip level with filtering

@group(0) @binding(0) var sourceTex: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Fullscreen triangle for texture-to-texture blit (no Y-flip needed)
  let x = f32((vertexIndex << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vertexIndex & 2u) * 2.0 - 1.0;

  output.position = vec4<f32>(x, y, 0.0, 1.0);  // No Y-flip for texture rendering
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Sample with linear filtering to downsample
  return textureSample(sourceTex, sourceSampler, input.uv);
}
