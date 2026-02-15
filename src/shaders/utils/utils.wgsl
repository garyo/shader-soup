// ============================================================================
// WGSL Utility Library
// Clean, dependency-free helpers for compute shaders
// ============================================================================

// ---------------------------------------------------------------------------
// Basic Math
// ---------------------------------------------------------------------------

// Clamp to [0,1]
fn saturate_f32(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}
fn saturate_v2(v: vec2<f32>) -> vec2<f32> {
    return clamp(v, vec2<f32>(0.0), vec2<f32>(1.0));
}
// saturate() takes vec3 — the most common case (colors)
fn saturate(v: vec3<f32>) -> vec3<f32> {
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}
fn saturate_v3(v: vec3<f32>) -> vec3<f32> {
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}
fn saturate_v4(v: vec4<f32>) -> vec4<f32> {
    return clamp(v, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Inverse lerp: return normalized position of v in [a,b]
fn inv_lerp(a: f32, b: f32, v: f32) -> f32 {
    return (v - a) / (b - a);
}

// Remap v from one range to another
fn remap(v: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) -> f32 {
    return mix(outMin, outMax, inv_lerp(inMin, inMax, v));
}

// Wrap x into [0,range)
fn wrap(x: f32, range: f32) -> f32 {
    return x - range * floor(x / range);
}

// Repeat with period r
fn repeat(x: f32, r: f32) -> f32 {
    return x - floor(x / r) * r;
}

// Ping-pong pattern
fn pingpong(x: f32, length: f32) -> f32 {
    let t = repeat(x, 2.0 * length);
    return length - abs(t - length);
}

// Smooth minimum (soft blend)
fn smooth_min(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate_f32(0.5 + 0.5 * (b - a) / k);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Smooth maximum
fn smooth_max(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate_f32(0.5 + 0.5 * (a - b) / k);
    return mix(a, b, h) - k * h * (1.0 - h);
}

// Safe normalize (returns zero vector if |v| == 0)
fn safe_normalize(v: vec3<f32>) -> vec3<f32> {
    let len = length(v);
    return select(vec3<f32>(0.0), v / len, len > 0.0);
}

// Return fractional and integer parts of x.
// Equivalent to GLSL/HLSL modf: x = ipart + fract
struct ModfResult {
    fract: f32,
    ipart: f32,
};

fn modf(x: f32) -> ModfResult {
    // trunc() removes the fractional part toward zero
    let ip = trunc(x);
    let fr = x - ip;
    return ModfResult(fr, ip);
}

// Vector overload
struct ModfResult3 {
    fract: vec3<f32>,
    ipart: vec3<f32>,
};

fn modf_v3(x: vec3<f32>) -> ModfResult3 {
    let ip = trunc(x);
    let fr = x - ip;
    return ModfResult3(fr, ip);
}

// ---------------------------------------------------------------------------
// Fast Approximate Math
// ---------------------------------------------------------------------------

// Fast inverse sqrt (one Newton iteration)
fn fast_inv_sqrt(x: f32) -> f32 {
    let half = 0.5 * x;
    var y = x;
    var i = bitcast<u32>(y);
    i = 0x5f3759dfu - (i >> 1u);
    y = bitcast<f32>(i);
    return y * (1.5 - half * y * y);
}

// Very rough exp approximation
fn fast_exp(x: f32) -> f32 {
    return 1.0 + x + 0.5 * x * x;
}

// Very rough log approximation (good for small variations)
fn fast_log(x: f32) -> f32 {
    let y = (x - 1.0) / (x + 1.0);
    let y2 = y * y;
    return 2.0 * (y + y * y2 * (1.0 / 3.0));
}

// ---------------------------------------------------------------------------
// RNG / Hashing
// ---------------------------------------------------------------------------

// uses hash_u32 from noise lib
fn rand_f32(seed: u32) -> f32 {
    return f32(hash_u32(seed)) / 4294967295.0;
}

// ---------------------------------------------------------------------------
// Color Helpers
// ---------------------------------------------------------------------------

// Convert linear RGB to sRGB
fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let a = 0.055;
    return select(
        12.92 * c,
        (1.0 + a) * pow(c, vec3(1.0/2.4)) - a,
        c > vec3(0.0031308)
    );
}

// Convert sRGB to linear RGB
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    return select(
        c / 12.92,
        pow((c + 0.055) / 1.055, vec3(2.4)),
        c > vec3(0.04045)
    );
}

// Convert HSV to RGB
// h: hue (0 to 2π radians)
// s: saturation (0 to 1)
// v: value (0 to 1)
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    let c = v * s;
    let x = c * (1.0 - abs((h / 1.047197551) % 2.0 - 1.0)); // 1.047197551 ≈ π/3
    let m = v - c;

    var rgb: vec3<f32>;
    let h60 = h / 1.047197551;

    if (h60 < 1.0) {
        rgb = vec3<f32>(c, x, 0.0);
    } else if (h60 < 2.0) {
        rgb = vec3<f32>(x, c, 0.0);
    } else if (h60 < 3.0) {
        rgb = vec3<f32>(0.0, c, x);
    } else if (h60 < 4.0) {
        rgb = vec3<f32>(0.0, x, c);
    } else if (h60 < 5.0) {
        rgb = vec3<f32>(x, 0.0, c);
    } else {
        rgb = vec3<f32>(c, 0.0, x);
    }

    return rgb + m;
}

// Convert RGB to HSV
// Returns vec3(h, s, v) where h is in radians (0 to 2π)
fn rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let cmax = max(max(rgb.r, rgb.g), rgb.b);
    let cmin = min(min(rgb.r, rgb.g), rgb.b);
    let delta = cmax - cmin;

    var h: f32 = 0.0;
    let s: f32 = select(0.0, delta / cmax, cmax > 0.0);
    let v: f32 = cmax;

    if (delta > 0.0) {
        if (cmax == rgb.r) {
            h = 1.047197551 * (((rgb.g - rgb.b) / delta) % 6.0); // π/3 * ...
        } else if (cmax == rgb.g) {
            h = 1.047197551 * ((rgb.b - rgb.r) / delta + 2.0);
        } else {
            h = 1.047197551 * ((rgb.r - rgb.g) / delta + 4.0);
        }
        if (h < 0.0) {
            h += 6.283185307; // Add 2π
        }
    }

    return vec3<f32>(h, s, v);
}

// ---------------------------------------------------------------------------
// Bit Ops
// ---------------------------------------------------------------------------

// Rotate left
fn rotl(x: u32, k: u32) -> u32 {
    return (x << k) | (x >> (32u - k));
}

// Rotate right
fn rotr(x: u32, k: u32) -> u32 {
    return (x >> k) | (x << (32u - k));
}

// Popcount (count bits)
fn popcount(x: u32) -> u32 {
    var v = x;
    v = v - ((v >> 1u) & 0x55555555u);
    v = (v & 0x33333333u) + ((v >> 2u) & 0x33333333u);
    return (((v + (v >> 4u)) & 0x0F0F0F0Fu) * 0x01010101u) >> 24u;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

fn orthonormal_basis(n: vec3<f32>) -> mat3x3<f32> {
    let a = select(vec3<f32>(1.0,0.0,0.0), vec3<f32>(0.0,1.0,0.0), abs(n.x) > 0.9);
    let v = normalize(cross(n, a));
    let u = cross(n, v);
    return mat3x3<f32>(u, v, n);
}

// N-way rotational symmetry with optional mirroring
// n: number of symmetry sectors (e.g., 6 for hexagonal)
// mirror: if true, mirrors every other sector for true reflection symmetry
fn radialSymmetry(p: vec2f, n: i32, mirror: bool) -> vec2f {
    let angle = atan2(p.y, p.x);
    let r = length(p);
    
    let sectorAngle = 6.28318530718 / f32(n);  // 2π / n
    
    // Find angle within the current sector [0, sectorAngle)
    let angleInSector = angle - floor(angle / sectorAngle) * sectorAngle;
    
    // Optionally mirror every other sector
    let finalAngle = select(
        angleInSector,
        select(
            angleInSector,
            sectorAngle - angleInSector,
            (i32(floor(angle / sectorAngle)) & 1) == 1
        ),
        mirror
    );
    
    return vec2f(r * cos(finalAngle), r * sin(finalAngle));
}

// Hexagonal grid
// Returns: xy = cell coordinates, z = cell ID hash, w = distance from center
fn hexGrid(p: vec2f) -> vec4f {
    // Hexagon dimensions: pointy-top orientation
    // A hexagon with circumradius 1 has:
    //   width = sqrt(3), height = 2
    //   horizontal spacing = sqrt(3), vertical spacing = 1.5
    
    let scale = vec2f(1.0 / sqrt(3.0), 1.0 / 1.5);
    let scaled = p * scale;
    
    // Two candidate grids offset by half a cell
    let gridA = floor(scaled);
    let gridB = floor(scaled + 0.5) - 0.5;
    
    // Local coordinates within each candidate
    let localA = scaled - gridA - 0.5;
    let localB = scaled - gridB - 0.5;
    
    // Pick the closer center
    let distA = dot(localA, localA);
    let distB = dot(localB, localB);
    
    let useA = step(distA, distB);
    let cell = mix(gridB, gridA, useA);
    let local = mix(localB, localA, useA);
    
    // Convert back to world-ish coordinates for the cell ID
    // Offset every other row to get unique IDs
    let cellInt = vec2i(cell);
    let id = hash_u32(u32(cellInt.x + cellInt.y * 1337));
    
    // Distance from hex center (Euclidean)
    let dist = length(local);
    
    return vec4f(cell, f32(id) / 4294967296.0, dist);
}

// ---------------------------------------------------------------------------
// 2D Signed Distance Functions (Polygons)
// From Inigo Quilez: https://iquilezles.org/articles/distfunctions2d/
// All return negative inside, positive outside.
// ---------------------------------------------------------------------------

// Equilateral triangle centered at origin, circumradius r
fn sdEquilateralTriangle(p_in: vec2f, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p = vec2f(abs(p_in.x) - r, p_in.y + r / k);
    if (p.x + k * p.y > 0.0) {
        p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p = vec2f(p.x - clamp(p.x, -2.0 * r, 0.0), p.y);
    return -length(p) * sign(p.y);
}

// Isosceles triangle: q.x = half-width at base, q.y = height
fn sdTriangleIsosceles(p_in: vec2f, q: vec2f) -> f32 {
    var p = vec2f(abs(p_in.x), p_in.y);
    let a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    let b = p - q * vec2f(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    let s = -sign(q.y);
    let d = min(vec2f(dot(a, a), s * (p.x * q.y - p.y * q.x)),
                vec2f(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
}

// General triangle with vertices p0, p1, p2
fn sdTriangle(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
    let e0 = p1 - p0;
    let e1 = p2 - p1;
    let e2 = p0 - p2;
    let v0 = p - p0;
    let v1 = p - p1;
    let v2 = p - p2;
    let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    let s = sign(e0.x * e2.y - e0.y * e2.x);
    let d = min(min(
        vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
        vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
        vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

// Regular pentagon, circumradius r
fn sdPentagon(p_in: vec2f, r: f32) -> f32 {
    let k = vec3f(0.809016994, 0.587785252, 0.726542528);
    var p = vec2f(abs(p_in.x), p_in.y);
    p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
    p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
    p -= vec2f(clamp(p.x, -r * k.z, r * k.z), r);
    return length(p) * sign(p.y);
}

// Regular hexagon, circumradius r
fn sdHexagon(p_in: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.866025404, 0.5, 0.577350269);
    var p = abs(p_in);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

// Regular octagon, circumradius r
fn sdOctagon(p_in: vec2f, r: f32) -> f32 {
    let k = vec3f(-0.9238795325, 0.3826834323, 0.4142135623);
    var p = abs(p_in);
    p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
    p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
    p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

// Regular star: r = outer radius, n = number of points, m = star ratio (2 < m < n)
fn sdStar(p_in: vec2f, r: f32, n: i32, m: f32) -> f32 {
    let an = 3.141593 / f32(n);
    let en = 3.141593 / m;
    let acs = vec2f(cos(an), sin(an));
    let ecs = vec2f(cos(en), sin(en));
    // GLSL-style mod for negative values: x - y * floor(x/y)
    let raw_angle = atan2(p_in.x, p_in.y);
    let bn = raw_angle - 2.0 * an * floor(raw_angle / (2.0 * an)) - an;
    var p = length(p_in) * vec2f(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

// Pentagram (five-pointed star), circumradius r
fn sdPentagram(p_in: vec2f, r: f32) -> f32 {
    let k1x = 0.809016994;
    let k2x = 0.309016994;
    let k1y = 0.587785252;
    let k2y = 0.951056516;
    let k1z = 0.726542528;
    let v1 = vec2f(k1x, -k1y);
    let v2 = vec2f(-k1x, -k1y);
    let v3 = vec2f(k2x, -k2y);
    var p = vec2f(abs(p_in.x), p_in.y);
    p -= 2.0 * max(dot(v1, p), 0.0) * v1;
    p -= 2.0 * max(dot(v2, p), 0.0) * v2;
    p = vec2f(abs(p.x), p.y - r);
    return length(p - v3 * clamp(dot(p, v3), 0.0, k1z * r)) * sign(p.y * v3.x - p.x * v3.y);
}

// Hexagram (Star of David), circumradius r
fn sdHexagram(p_in: vec2f, r: f32) -> f32 {
    let k = vec4f(-0.5, 0.8660254038, 0.5773502692, 1.7320508076);
    var p = abs(p_in);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= 2.0 * min(dot(k.yx, p), 0.0) * k.yx;
    p -= vec2f(clamp(p.x, r * k.z, r * k.w), r);
    return length(p) * sign(p.y);
}

// ---------------------------------------------------------------------------
// Matrix Helpers
// ---------------------------------------------------------------------------

// Outer product: a * b^T
fn outer(a: vec3<f32>, b: vec3<f32>) -> mat3x3<f32> {
    return mat3x3<f32>(
        a * b.x,
        a * b.y,
        a * b.z
    );
}

// Multiply point by 4x4 matrix (w=1)
fn mul_point(m: mat4x4<f32>, p: vec3<f32>) -> vec3<f32> {
    let r = m * vec4<f32>(p, 1.0);
    return r.xyz / r.w;
}

// Multiply direction vector (w=0)
fn mul_vector(m: mat4x4<f32>, v: vec3<f32>) -> vec3<f32> {
    return (m * vec4<f32>(v, 0.0)).xyz;
}

// ---------------------------------------------------------------------------
// Compositing helpers
// ---------------------------------------------------------------------------

fn screen_f32(a: f32, b: f32) -> f32 {
   return a + b - a * b;
}

fn screen(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
   return a + b - a * b;
}

fn screen_color(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
   return a + b - a * b;
}

// ---------------------------------------------------------------------------
// Coordinate Utilities
// ---------------------------------------------------------------------------

// Get normalized UV coordinates from pixel position
// Returns vec2<f32> with:
//   - X: -1.0 (left) to 1.0 (right)
//   - Y: aspect-ratio scaled, centered at 0.0
//
// Parameters:
//   - inxy: pixel coordinates (global_invocation_id.xy)
//   - width: image width in pixels
//   - height: image height in pixels
//   - pan: pan offset (panX shifts view left, panY shifts view up)
//   - zoom: zoom factor (>1 zooms in, <1 zooms out)
//
// Example usage:
//   let uv = get_uv(id.xy, dimensions.width, dimensions.height, vec2f(0.0, 0.0), 1.0);
fn get_uv(inxy: vec2<u32>, width: u32, height: u32, pan: vec2<f32>, zoom: f32) -> vec2<f32> {
    let aspectRatio = f32(width) / f32(height);

    // Normalize X to -1 to 1
    let normalizedX = (f32(inxy.x) / f32(width - 1u)) * 2.0 - 1.0;

    // Normalize Y to maintain aspect ratio, centered at 0
    let normalizedY = ((f32(inxy.y) / f32(height - 1u)) * 2.0 - 1.0) / aspectRatio;

    // Apply zoom and pan transformations
    // Zoom: divide by zoom (zoom > 1 = zoom in, smaller coord range)
    // Pan: subtract panX (positive panX shifts view left), add panY (positive panY shifts view up)
    let transformedX = normalizedX / zoom - pan.x;
    let transformedY = normalizedY / zoom + pan.y;

    return vec2<f32>(transformedX, transformedY);
}
