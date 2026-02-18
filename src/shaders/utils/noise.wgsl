// Noise Utility Library for WGSL
// Collection of noise and hash functions for procedural generation
// Source: https://gist.github.com/munrocket/236ed5ba7e409b8bdf1ff6eca5dcdc39

// =============================================================================
// HASH FUNCTIONS
// =============================================================================

// PCG hash - fast pseudorandom number generator
fn pcg(n: u32) -> u32 {
    var h = n * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    return (h >> 22u) ^ h;
}

// Single u32 finalizer (based on lowbias32)
fn hash_u32(n: u32) -> u32 {
    var h = n;
    h ^= h >> 16;
    h *= 0x7feb352du;
    h ^= h >> 15;
    h *= 0x846ca68bu;
    h ^= h >> 16;
    return h;
}

// Hash 2D integer coordinates to float in [0, 1)
fn hash21(p: vec2f) -> f32 {
    // Combine coordinates using bitcast to preserve bit patterns
    let ix = bitcast<u32>(p.x);
    let iy = bitcast<u32>(p.y);
    
    // Mix the two values - this is critical for quality
    let n = ix ^ (iy * 0x1b873593u);
    
    return f32(hash_u32(n)) * (1.0 / 4294967296.0);
}

// Hash 2D position to vec2 in [0, 1]
fn hash22(p: vec2f) -> vec2f {
    let ix = bitcast<u32>(p.x);
    let iy = bitcast<u32>(p.y);
    
    // Generate two different hashes by varying the combination
    let h1 = hash_u32(ix ^ (iy * 0x1b873593u));
    let h2 = hash_u32(iy ^ (ix * 0x85ebca6bu));
    
    return vec2f(
        f32(h1) * (1.0 / 4294967296.0),
        f32(h2) * (1.0 / 4294967296.0)
    );
}

// =============================================================================
// VALUE NOISE
// =============================================================================

// Simple 2D value noise
fn valueNoise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);

    // Smooth interpolation curve
    let u = f * f * (3.0 - 2.0 * f);

    // Sample corners
    let a = hash21(i);
    let b = hash21(i + vec2f(1.0, 0.0));
    let c = hash21(i + vec2f(0.0, 1.0));
    let d = hash21(i + vec2f(1.0, 1.0));

    // Bilinear interpolation
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// =============================================================================
// PERLIN NOISE
// =============================================================================

// Permutation function for Perlin noise
fn permute4(x: vec4f) -> vec4f {
    return ((x * 34.0 + 1.0) * x) - floor(((x * 34.0 + 1.0) * x) / 289.0) * 289.0;
}

// Fade function for smooth interpolation
fn fade2(t: vec2f) -> vec2f {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Classic 2D Perlin noise
fn perlinNoise2(P: vec2f) -> f32 {
    var Pi: vec4f = floor(P.xyxy) + vec4f(0.0, 0.0, 1.0, 1.0);
    let Pf = fract(P.xyxy) - vec4f(0.0, 0.0, 1.0, 1.0);
    Pi = Pi - floor(Pi / 289.0) * 289.0;  // Modulo 289
    let ix = Pi.xzxz;
    let iy = Pi.yyww;
    let fx = Pf.xzxz;
    let fy = Pf.yyww;
    let i = permute4(permute4(ix) + iy);
    var gx: vec4f = 2.0 * fract(i * 0.0243902439) - 1.0;
    let gy = abs(gx) - 0.5;
    let tx = floor(gx + 0.5);
    gx = gx - tx;
    var g00: vec2f = vec2f(gx.x, gy.x);
    var g10: vec2f = vec2f(gx.y, gy.y);
    var g01: vec2f = vec2f(gx.z, gy.z);
    var g11: vec2f = vec2f(gx.w, gy.w);
    let norm = 1.79284291400159 - 0.85373472095314 *
        vec4f(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11));
    g00 = g00 * norm.x;
    g01 = g01 * norm.y;
    g10 = g10 * norm.z;
    g11 = g11 * norm.w;
    let n00 = dot(g00, vec2f(fx.x, fy.x));
    let n10 = dot(g10, vec2f(fx.y, fy.y));
    let n01 = dot(g01, vec2f(fx.z, fy.z));
    let n11 = dot(g11, vec2f(fx.w, fy.w));
    let fade_xy = fade2(Pf.xy);
    let n_x = mix(vec2f(n00, n01), vec2f(n10, n11), vec2f(fade_xy.x));
    let n_xy = mix(n_x.x, n_x.y, fade_xy.y);
    return 2.3 * n_xy;
}

// =============================================================================
// SIMPLEX NOISE (faster than Perlin — 3 corners vs 4, no fade curve)
// =============================================================================

// 2D Simplex noise — returns approximately [-1, 1]
// ~30-40% faster than perlinNoise2 but can look slightly blobby,
// so best used for displacement, warping, or indirect modulation
// rather than directly visible patterns.
fn simplexNoise2(p: vec2f) -> f32 {
    let C = vec2f(0.211324865405187, 0.366025403784439); // (3-sqrt(3))/6, (sqrt(3)-1)/2
    let D = vec3f(0.0, 0.5, 2.0) * 0.0 + vec3f(0.0, 0.5, 2.0); // helper

    // Skew to simplex grid
    var i = floor(p + dot(p, vec2f(C.y, C.y)));
    let x0 = p - i + dot(i, vec2f(C.x, C.x));

    // Which simplex triangle?
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);

    // Corners: x0 = x0, x1 = x0 - i1 + C.x, x2 = x0 - 1.0 + 2*C.x
    let x1 = x0 - i1 + vec2f(C.x, C.x);
    let x2 = x0 - 1.0 + 2.0 * vec2f(C.x, C.x);

    // Wrap grid coords mod 289
    i = i - floor(i / 289.0) * 289.0;

    // Permutation for gradient indices
    let p3 = permute4(vec4f(i.y, i.y + i1.y, i.y + 1.0, 0.0));
    let pp = permute4(vec4f(p3.x + i.x, p3.y + i.x + i1.x, p3.z + i.x + 1.0, 0.0));

    // Gradients from permutation
    let gx0 = 2.0 * fract(pp.x * (1.0 / 41.0)) - 1.0;
    let gy0 = abs(gx0) - 0.5;
    let gx0c = gx0 - floor(gx0 + 0.5); // center

    let gx1 = 2.0 * fract(pp.y * (1.0 / 41.0)) - 1.0;
    let gy1 = abs(gx1) - 0.5;
    let gx1c = gx1 - floor(gx1 + 0.5);

    let gx2 = 2.0 * fract(pp.z * (1.0 / 41.0)) - 1.0;
    let gy2 = abs(gx2) - 0.5;
    let gx2c = gx2 - floor(gx2 + 0.5);

    // Normalize gradients
    let g0 = vec2f(gx0c, gy0) * inverseSqrt(gx0c * gx0c + gy0 * gy0);
    let g1 = vec2f(gx1c, gy1) * inverseSqrt(gx1c * gx1c + gy1 * gy1);
    let g2 = vec2f(gx2c, gy2) * inverseSqrt(gx2c * gx2c + gy2 * gy2);

    // Radial falloff: (0.5 - |x|^2)^4
    var n0: f32 = 0.0;
    var t0 = 0.5 - dot(x0, x0);
    if (t0 >= 0.0) { t0 *= t0; n0 = t0 * t0 * dot(g0, x0); }

    var n1: f32 = 0.0;
    var t1 = 0.5 - dot(x1, x1);
    if (t1 >= 0.0) { t1 *= t1; n1 = t1 * t1 * dot(g1, x1); }

    var n2: f32 = 0.0;
    var t2 = 0.5 - dot(x2, x2);
    if (t2 >= 0.0) { t2 *= t2; n2 = t2 * t2 * dot(g2, x2); }

    // Scale to roughly [-1, 1]
    return 70.0 * (n0 + n1 + n2);
}

// =============================================================================
// FRACTAL NOISE (FBM - Fractional Brownian Motion)
// =============================================================================

// Rotation matrix for FBM
const fbmRotation: mat2x2f = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));

// FBM using Perlin noise - 4 octaves
fn fbmPerlin(p: vec2f) -> f32 {
    var f: f32 = 0.0;
    var pos = p;

    f += 0.5000 * perlinNoise2(pos);
    pos = fbmRotation * pos * 2.02;

    f += 0.2500 * perlinNoise2(pos);
    pos = fbmRotation * pos * 2.03;

    f += 0.1250 * perlinNoise2(pos);
    pos = fbmRotation * pos * 2.01;

    f += 0.0625 * perlinNoise2(pos);

    return f / 0.9375;
}

// FBM using simplex noise - 4 octaves (faster than fbmPerlin)
fn fbmSimplex(p: vec2f) -> f32 {
    var f: f32 = 0.0;
    var pos = p;

    f += 0.5000 * simplexNoise2(pos);
    pos = fbmRotation * pos * 2.02;

    f += 0.2500 * simplexNoise2(pos);
    pos = fbmRotation * pos * 2.03;

    f += 0.1250 * simplexNoise2(pos);
    pos = fbmRotation * pos * 2.01;

    f += 0.0625 * simplexNoise2(pos);

    return f / 0.9375;
}

// FBM using value noise - 4 octaves
fn fbmValue(p: vec2f) -> f32 {
    var f: f32 = 0.0;
    var pos = p;

    f += 0.5000 * valueNoise2(pos);
    pos = fbmRotation * pos * 2.02;

    f += 0.2500 * valueNoise2(pos);
    pos = fbmRotation * pos * 2.03;

    f += 0.1250 * valueNoise2(pos);
    pos = fbmRotation * pos * 2.01;

    f += 0.0625 * valueNoise2(pos);

    return f / 0.9375;
}

// Customizable FBM with Perlin noise
// @param p: Position
// @param octaves: Number of octaves (more = more detail, slower)
// @param lacunarity: Frequency multiplier per octave (typically ~2.0)
// @param gain: Amplitude multiplier per octave (typically ~0.5)
fn fbmPerlinCustom(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var f: f32 = 0.0;
    var amplitude: f32 = 0.5;
    var frequency: f32 = 1.0;
    var pos = p;
    var totalAmplitude: f32 = 0.0;

    for (var i = 0; i < octaves; i++) {
        f += amplitude * perlinNoise2(pos * frequency);
        totalAmplitude += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
        pos = fbmRotation * pos;
    }

    return f / totalAmplitude;
}

// =============================================================================
// TURBULENCE & WARPING
// =============================================================================

// Turbulence - absolute value of noise
fn turbulence(p: vec2f, octaves: i32) -> f32 {
    var f: f32 = 0.0;
    var amplitude: f32 = 0.5;
    var frequency: f32 = 1.0;
    var pos = p;

    for (var i = 0; i < octaves; i++) {
        f += amplitude * abs(perlinNoise2(pos * frequency));
        amplitude *= 0.5;
        frequency *= 2.0;
        pos = fbmRotation * pos;
    }

    return f;
}

// Domain warping - distort input space with noise
fn domainWarp(p: vec2f, amount: f32) -> vec2f {
    let offset = vec2f(
        perlinNoise2(p + vec2f(0.0, 0.0)),
        perlinNoise2(p + vec2f(5.2, 1.3))
    );
    return p + offset * amount;
}

// =============================================================================
// SPECIAL NOISE PATTERNS
// =============================================================================

// Voronoi-like cellular noise
fn cellularNoise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);

    var minDist = 1.0;

    // Check 3x3 neighborhood
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let neighbor = vec2f(f32(x), f32(y));
            let cell = i + neighbor;
            let point = neighbor + hash22(cell) - f;
            let dist = length(point);
            minDist = min(minDist, dist);
        }
    }

    return minDist;
}

// Ridge noise - inverted absolute noise
fn ridgeNoise(p: vec2f, octaves: i32) -> f32 {
    var f: f32 = 0.0;
    var amplitude: f32 = 0.5;
    var frequency: f32 = 1.0;
    var pos = p;

    for (var i = 0; i < octaves; i++) {
        let n = 1.0 - abs(perlinNoise2(pos * frequency));
        f += amplitude * n * n;  // Square for sharper ridges
        amplitude *= 0.5;
        frequency *= 2.0;
        pos = fbmRotation * pos;
    }

    return f;
}
