// ============================================================================
// WGSL Utility Library
// Clean, dependency-free helpers for compute shaders
// ============================================================================

// ---------------------------------------------------------------------------
// Basic Math
// ---------------------------------------------------------------------------

// Clamp to [0,1]
fn saturate(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn saturate_v2(v: vec2<f32>) -> vec2<f32> {
    return clamp(v, vec2<f32>(0.0), vec2<f32>(1.0));
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
    let h = saturate(0.5 + 0.5 * (b - a) / k);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Smooth maximum
fn smooth_max(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate(0.5 + 0.5 * (a - b) / k);
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

fn hash_u32(x: u32) -> u32 {
    var h = x * 0x85ebca6bu;
    h ^= h >> 13u;
    h *= 0xc2b2ae35u;
    h ^= h >> 16u;
    return h;
}

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
