// The procedural particle shader: one GLSL program that paints every particle look (orbs, sparks, motes, flames,
// crystals, runes, portals, shields and auras) from a handful of numbers. Rendered live into shared textures for
// animation, and once at a fixed time to bake the image file a token uses. A molded particle also has an outline:
// space is stretched so the outline becomes the circle every look is drawn in.

import {PROFILE_MAX, PROFILE_SIZE, encodeProfile, outlineKey, radialProfile} from "./outline.js";

export const KINDS = {
  orb: {id: 0, label: "Orb", icon: "fa-solid fa-circle"},
  spark: {id: 1, label: "Spark / star", icon: "fa-solid fa-star"},
  mote: {id: 2, label: "Mote", icon: "fa-solid fa-circle-dot"},
  flame: {id: 3, label: "Flame / wisp", icon: "fa-solid fa-fire"},
  shard: {id: 4, label: "Crystal shard", icon: "fa-solid fa-gem"},
  rune: {id: 5, label: "Rune circle", icon: "fa-solid fa-dharmachakra"},
  vortex: {id: 6, label: "Portal / vortex", icon: "fa-solid fa-hurricane"},
  bubble: {id: 7, label: "Shield / bubble", icon: "fa-solid fa-shield-halved"},
  aura: {id: 8, label: "Aura ring", icon: "fa-solid fa-sun"}
};

export const VERTEX = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const FRAGMENT = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uSeed;
uniform float uKind;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uSize;
uniform float uScale;
uniform float uDetail;
uniform float uWarp;
uniform float uVeins;
uniform float uSwirl;
uniform float uSpin;
uniform float uPulse;
uniform float uPulseRate;
uniform float uGlow;
uniform float uCore;
uniform float uRim;
uniform float uSparkle;
uniform float uShape;
uniform float uAlpha;
uniform float uMolded;
uniform sampler2D uProfile;

#define PI 3.14159265
#define TAU 6.28318531
#define PROFILE_N ${PROFILE_SIZE.toFixed(1)}
#define PROFILE_MAX ${PROFILE_MAX.toFixed(1)}

// x² without pow(): pow() of a negative number is undefined in GLSL ES (NaN on some GPUs)
float sq(float x) {
  return x * x;
}

// A molded particle's outline: how far it reaches in each of PROFILE_N directions, 16 bits in red and green. Read
// exactly (nearest texel at its centre) and blend the two directions either side.
float profileAt(float i) {
  vec4 c = texture2D(uProfile, vec2((mod(i, PROFILE_N) + 0.5) / PROFILE_N, 0.5));
  return (c.r * 65280.0 + c.g * 255.0) / 65535.0 * PROFILE_MAX;
}

float outlineRadius(vec2 p) {
  if ( dot(p, p) < 1e-10 ) return 1.0;
  float u = (atan(p.y, p.x) + PI) / TAU * PROFILE_N - 0.5;
  float i0 = floor(u);
  return mix(profileAt(i0), profileAt(i0 + 1.0), u - i0);
}

vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float hash1(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(hash3(i) * 2.0 - 1.0, f);
  float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for ( int i = 0; i < 6; i++ ) {
    if ( float(i) >= uDetail ) break;
    s += a * gnoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 3.4);
    a *= 0.5;
  }
  return 1.6 * s / max(n, 0.0001);
}

float ridge(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  float prev = 1.0;
  for ( int i = 0; i < 5; i++ ) {
    if ( float(i) >= uDetail ) break;
    float n = 1.0 - abs(gnoise(p) * 1.8);
    n = n * n;
    s += n * a * prev;
    prev = n;
    p = p * 2.1 + vec3(3.1, 1.7, 5.3);
    a *= 0.5;
  }
  return s;
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  if ( t < 1.0 ) return mix(uC0, uC1, t);
  if ( t < 2.0 ) return mix(uC1, uC2, t - 1.0);
  return mix(uC2, uC3, t - 2.0);
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float pulseAt(float amount) {
  return 1.0 + uPulse * amount * sin(uTime * uPulseRate * TAU);
}

vec3 seedOffset() {
  return vec3(uSeed * 7.13, uSeed * 3.71, uSeed * 1.37);
}

/* A sphere of swirling, domain-warped noise with core light, rim light, veins, sparkles and a halo. */
vec4 orb(vec2 p) {
  float t = uTime;
  float R = uSize * pulseAt(0.05);
  float r = length(p);
  float halo = uGlow * exp(-pow(max(r - R, 0.0) / (0.06 + 0.3 * uGlow), 1.25) * 2.2);
  halo *= 1.0 - smoothstep(0.8, 1.0, r);
  vec4 col = vec4(ramp(0.7) * halo, halo);
  if ( r < R + 0.01 ) {
    vec2 q = p / R;
    float z = sqrt(max(0.0, 1.0 - dot(q, q)));
    vec3 n = vec3(q, z);
    n.xz = rot(t * uSpin) * n.xz;
    n.yz = rot(0.4) * n.yz;
    vec3 np = n * uScale + seedOffset();
    vec3 flow = vec3(0.0, 0.0, t * uSwirl);
    float w1 = fbm(np + flow);
    float w2 = fbm(np + vec3(5.2, 1.3, 2.8) - flow * 0.7);
    float f = fbm(np + uWarp * vec3(w1, w2, w1 * w2) + flow * 0.5);
    float v = clamp(0.5 + f * 0.75, 0.0, 1.0);
    float shade = mix(0.5, 1.0, z);
    vec3 c = ramp(v * 0.85 + 0.12 * z) * shade;
    if ( uVeins > 0.0 ) {
      float rv = ridge(np * 1.2 + flow * 1.6 + vec3(w1, w2, 0.0));
      c += ramp(1.0) * pow(rv, 3.0) * uVeins * 2.5;
    }
    c += ramp(0.95) * uCore * pow(z, 4.0);
    c += ramp(0.85) * pow(1.0 - z, 2.5) * uRim * 1.4;
    if ( uSparkle > 0.0 ) {
      vec3 g = np * 3.0;
      vec3 cell = floor(g);
      float h = hash1(cell + floor(t * 1.5 + hash1(cell) * 10.0));
      float star = step(0.93 - 0.08 * uSparkle, h) * pow(max(0.0, 1.0 - length(fract(g) - 0.5) * 2.6), 4.0);
      c += ramp(1.0) * star * uSparkle * 3.0;
    }
    vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
    float spec = pow(max(dot(reflect(-L, vec3(q, z)), vec3(0.0, 0.0, 1.0)), 0.0), 30.0);
    c += vec3(spec * 0.5);
    float edge = 1.0 - smoothstep(R - 0.012, R + 0.004, r);
    col = vec4(c, 1.0) * edge + col * (1.0 - edge);
  }
  return col;
}

/* A twinkling star with a hot core, light rays and a soft glow. */
vec4 spark(vec2 p) {
  float t = uTime;
  float tw = 1.0 - uPulse * 0.45 * (0.5 + 0.5 * sin(t * uPulseRate * TAU + uSeed * 17.0));
  vec2 q = rot(t * uSpin + uSeed) * p;
  float r = length(q);
  float a = atan(q.y, q.x);
  float rays = max(2.0, floor(uShape + 0.5));
  float core = exp(-r * r / (0.002 + 0.03 * uSize * uSize));
  float beam = pow(abs(cos(a * rays * 0.5)), 24.0 + 40.0 * (1.0 - uGlow)) * exp(-r * (6.5 - 3.5 * uSize));
  float beam2 = pow(abs(cos(a * rays * 0.5 + PI / rays)), 60.0) * exp(-r * 9.0) * 0.5;
  float glow = exp(-r * r * (10.0 - 7.0 * uGlow)) * 0.55 * uGlow;
  float I = (core * 1.8 + beam * 1.1 + beam2 + glow) * tw;
  vec3 c = mix(ramp(0.55), ramp(1.0), clamp(core * 1.4 + beam * 0.4, 0.0, 1.0));
  float A = clamp(I, 0.0, 1.0);
  return vec4(c * A, A);
}

/* A soft breathing ball of light with a fuzzy, living edge. */
vec4 mote(vec2 p) {
  float t = uTime;
  float r = length(p);
  float n = fbm(vec3(p * uScale * 0.8, t * uSwirl + uSeed));
  float R = uSize * (1.0 + 0.18 * n) * pulseAt(0.12);
  float body = 1.0 - smoothstep(R * 0.15, R, r);
  float glow = uGlow * exp(-sq(r / (R * (1.4 + 1.6 * uGlow))) * 2.0);
  float I = max(body, glow * 0.85);
  vec3 c = ramp(0.4 + 0.5 * body + 0.15 * n);
  c += ramp(1.0) * uCore * exp(-r * r / (R * R * 0.12));
  return vec4(c * I, I);
}

/* A flame or wisp: tip up, flickering with rising noise. */
vec4 flame(vec2 p) {
  float t = uTime;
  vec2 q = vec2(p.x, -p.y);
  float h = clamp((q.y + 0.78) / 1.65, 0.0, 1.0);
  float n = fbm(vec3(q.x * uScale * 0.6, q.y * uScale * 0.6 - t * uSwirl * 2.0, uSeed + t * 0.25));
  float n2 = fbm(vec3(q.x * uScale * 1.7, q.y * uScale * 1.7 - t * uSwirl * 3.3, uSeed * 2.0 + 4.0));
  float x = q.x + n * 0.28 * h + n2 * 0.06 * (0.3 + h);
  float rb = uSize * 0.5 * pulseAt(0.06);
  float yb = -0.42;
  float bulb = length(vec2(x, (q.y - yb) * 1.15)) / rb;
  float up = clamp((q.y - yb) / (1.25 + 0.25 * uSize), 0.0, 1.0);
  float width = rb * pow(1.0 - up, 1.15);
  float taper = q.y > yb ? abs(x) / max(width, 0.001) : 10.0;
  float d = min(bulb, taper);
  float body = (1.0 - smoothstep(0.5, 1.0, d)) * (1.0 - smoothstep(0.85, 1.0, up + n2 * 0.08));
  float heat = clamp((1.0 - d) * (1.05 - h * 0.85) + n * 0.25 + uCore * 0.25 * (1.0 - h), 0.0, 1.0);
  vec3 c = ramp(heat);
  float glow = uGlow * exp(-length(vec2(q.x * 1.1, (q.y + 0.25) * 0.75)) * 3.2) * 0.55;
  float I = clamp(body + glow * (1.0 - body), 0.0, 1.0);
  vec3 col = (c * body + ramp(0.55) * glow * (1.0 - body)) / max(I, 0.0001);
  return vec4(col * I, I);
}

/* A faceted crystal: polygon silhouette, shaded facets, glints and inner glow. */
vec4 shard(vec2 p) {
  float t = uTime;
  vec2 q = rot(t * uSpin) * p;
  q.y *= 0.6;
  float sides = max(3.0, floor(uShape + 0.5));
  float a = atan(q.y, q.x) + PI * 0.5;
  float seg = TAU / sides;
  float ang = mod(a, seg) - seg * 0.5;
  float r = length(q);
  float rd = r * cos(ang) / cos(seg * 0.5);
  float R = uSize * 0.62;
  float inside = 1.0 - smoothstep(R - 0.012, R + 0.004, rd);
  float facet = floor(mod(a, TAU) / seg);
  float lit = 0.35 + 0.65 * hash1(vec3(facet, uSeed, 3.0));
  float sweep = 0.5 + 0.5 * sin(facet * 1.7 + t * (uSwirl * 2.0 + 0.3));
  float inner = fbm(vec3(q * uScale, uSeed + t * 0.15));
  vec3 c = ramp(clamp(0.25 + 0.5 * lit * (0.6 + 0.4 * sweep) + 0.2 * inner + 0.25 * (1.0 - rd / R), 0.0, 1.0));
  float angV = mod(a + seg * 0.5, seg) - seg * 0.5;
  float spoke = 1.0 - smoothstep(0.0, 0.012, abs(sin(angV)) * r);
  c += ramp(1.0) * spoke * 0.55 * inside;
  float rim = smoothstep(R - 0.07, R - 0.01, rd) * inside;
  c += ramp(1.0) * rim * uRim;
  c += ramp(1.0) * uCore * exp(-r * r / (R * R * 0.08)) * 0.8;
  float glint = pow(max(0.0, sin(t * 2.5 + facet * 2.3 + uSeed)), 40.0) * uSparkle;
  c += vec3(glint) * inside;
  float glow = uGlow * exp(-max(rd - R, 0.0) * 8.0) * (1.0 - inside) * 0.7;
  return vec4(c * inside + ramp(0.8) * glow, max(inside, glow));
}

/* A magic circle: rings, a rotating glyph band and a counter-rotating star. */
vec4 rune(vec2 p) {
  float t = uTime;
  float r = length(p);
  float R = uSize;
  float w = 0.008 + 0.012 * uGlow;
  float lines = 0.0;
  lines += exp(-sq((r - R) / w));
  lines += exp(-sq((r - R * 0.86) / (w * 0.8))) * 0.85;
  lines += exp(-sq((r - R * 0.42) / (w * 0.8))) * 0.7;
  vec2 q = rot(t * uSpin) * p;
  float a = atan(q.y, q.x);
  float N = 28.0;
  float f = fract((a + PI) / TAU * N);
  float cell = floor((a + PI) / TAU * N);
  float band = (r - R * 0.88) / (R * 0.1);
  float inBand = step(0.0, band) * step(band, 1.0);
  float h1 = hash1(vec3(cell, uSeed, 1.0));
  float h2 = hash1(vec3(cell, uSeed, 2.0));
  float glyph = step(0.3, h1) * exp(-sq((f - 0.5) / 0.07));
  glyph += step(0.45, h2) * exp(-sq((band - h2) / 0.13)) * step(0.2, f) * step(f, 0.8);
  glyph += step(0.75, h1) * exp(-sq((f - 0.25) / 0.06)) * step(0.4, band);
  lines += glyph * inBand;
  vec2 s = rot(-t * uSpin * 0.6) * p;
  float sides = max(3.0, floor(uShape + 0.5));
  float skip = sides >= 5.0 ? 2.0 : 1.0;
  float sd = 1000.0;
  for ( int k = 0; k < 12; k++ ) {
    if ( float(k) >= sides ) break;
    float a0 = TAU * float(k) / sides - PI * 0.5;
    float a1 = TAU * (float(k) + skip) / sides - PI * 0.5;
    sd = min(sd, sdSegment(s, vec2(cos(a0), sin(a0)) * R * 0.84, vec2(cos(a1), sin(a1)) * R * 0.84));
  }
  lines += exp(-sq(sd / w));
  float pulse = pulseAt(0.3);
  float I = clamp(lines * pulse, 0.0, 1.0);
  vec3 c = ramp(0.55 + 0.45 * I);
  float glow = uGlow * exp(-sq((r - R * 0.7) / 0.4)) * 0.22 * (1.0 - smoothstep(R, 1.0, r));
  float A = max(I, glow);
  return vec4(c * I + ramp(0.6) * glow, A);
}

/* A swirling portal disk with a dark heart and a bright horizon. */
vec4 vortex(vec2 p) {
  float t = uTime;
  float r = length(p);
  float a = atan(p.y, p.x);
  float R = uSize;
  float arms = max(1.0, floor(uShape + 0.5));
  float n = fbm(vec3(p * uScale, t * uSwirl + uSeed));
  float sw = a + log(r + 0.05) * (2.0 + uWarp * 2.5) - t * uSpin;
  float bands = 0.5 + 0.5 * sin(sw * arms + n * 3.0);
  float disk = 1.0 - smoothstep(R * 0.55, R, r);
  float hole = smoothstep(R * 0.16, R * 0.3, r);
  float I = disk * (0.3 + 0.7 * bands);
  vec3 c = ramp(clamp(bands * 0.65 + (1.0 - r / R) * 0.45 + n * 0.15, 0.0, 1.0));
  float ring = exp(-sq((r - R * 0.24) / 0.035)) * uRim;
  vec3 dark = uC0 * 0.25;
  c = mix(dark, c, hole) + ramp(1.0) * ring * 1.5;
  I = max(mix(disk, I, hole), ring);
  float glow = uGlow * exp(-max(r - R * 0.75, 0.0) * 6.0) * 0.5 * (1.0 - disk);
  return vec4(c * I + ramp(0.7) * glow, clamp(max(I, glow), 0.0, 1.0));
}

/* A translucent shield or bubble: fresnel edge, iridescence or hex cells, highlight. */
vec4 bubble(vec2 p) {
  float t = uTime;
  float r = length(p);
  float wob = fbm(vec3(p * 2.0, t * uSwirl + uSeed)) * 0.03;
  float R = uSize * (1.0 + wob) * pulseAt(0.03);
  vec2 q = p / R;
  float z = sqrt(max(0.0, 1.0 - dot(q, q)));
  float edge = 1.0 - smoothstep(R - 0.01, R + 0.004, r);
  float fres = sq(1.0 - z);
  float film = fres * 1.6 + fbm(vec3(q * uScale, t * 0.25 + uSeed)) * 1.2 + t * 0.08;
  vec3 irid = 0.5 + 0.5 * cos(TAU * (film + vec3(0.0, 0.33, 0.67)));
  vec3 c = mix(ramp(0.75), irid, uSparkle * 0.6);
  float hexA = 0.0;
  if ( uVeins > 0.0 ) {
    vec2 h = (q / max(z, 0.25)) * (2.0 + uScale * 0.8);
    h.x *= 1.1547;
    h.y += mod(floor(h.x), 2.0) * 0.5;
    vec2 g = abs(fract(h) - 0.5);
    float cellEdge = abs(max(g.x * 1.5 + g.y, g.y * 2.0) - 1.0);
    hexA = (1.0 - smoothstep(0.0, 0.08, cellEdge)) * uVeins * (0.35 + 0.65 * (0.5 + 0.5 * sin(t * 2.0 + h.x + h.y)));
  }
  vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
  float spec = pow(max(dot(reflect(-L, vec3(q, z)), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  float A = clamp(0.06 + fres * (0.25 + 0.9 * uRim) + hexA * 0.8 + spec * 0.8 + uCore * 0.15, 0.0, 1.0) * edge;
  vec3 col = (c * (A - spec * 0.8 * edge) + vec3(spec) * 0.8 * edge + ramp(1.0) * hexA * 0.6) / max(A, 0.0001);
  float glow = uGlow * exp(-max(r - R, 0.0) * 12.0) * (1.0 - edge) * 0.5;
  return vec4(col * A + ramp(0.8) * glow, max(A, glow));
}

/* A ring of flowing energy around a token, transparent in the middle. */
vec4 aura(vec2 p) {
  float t = uTime;
  float r = length(p);
  float a = atan(p.y, p.x);
  float R = uSize;
  float n = fbm(vec3(cos(a) * uScale, sin(a) * uScale, r * uScale * 1.4 - t * uSwirl) + seedOffset());
  float thick = (0.98 - R) * (0.5 + 0.5 * n) * pulseAt(0.12);
  float d = (r - R) / max(thick, 0.001);
  float inner = smoothstep(R - 0.05, R, r);
  float flameBody = inner * (1.0 - smoothstep(0.15, 1.0, d));
  float ring = exp(-sq((r - R) / 0.025)) * uRim;
  float I = clamp(flameBody * (0.55 + 0.45 * n) + ring, 0.0, 1.0);
  vec3 c = ramp(clamp(1.0 - d * 0.75 + n * 0.2, 0.0, 1.0));
  float inGlow = uGlow * smoothstep(0.0, R, r) * (1.0 - inner) * 0.3;
  float sp = 0.0;
  if ( uSparkle > 0.0 ) {
    float cell = floor((a + PI) / TAU * 40.0);
    float life = fract(t * 0.35 + hash1(vec3(cell, uSeed, 5.0)));
    float rr = R + life * (0.98 - R);
    float aa = (cell + 0.5) / 40.0 * TAU - PI;
    vec2 pt = vec2(cos(aa), sin(aa)) * rr;
    sp = exp(-sq(length(p - pt) / 0.012)) * (1.0 - life) * uSparkle * step(0.5, hash1(vec3(cell, uSeed, 9.0)));
  }
  vec3 col = c * I + ramp(0.6) * inGlow + ramp(1.0) * sp;
  return vec4(col, clamp(max(max(I, inGlow), sp), 0.0, 1.0));
}

void main() {
  vec2 p0 = vUv * 2.0 - 1.0;
  // Molded: the outline is where the unit circle used to be
  vec2 p = uMolded > 0.5 ? p0 / max(outlineRadius(p0), 0.02) : p0;
  vec4 c;
  if ( uKind < 0.5 ) c = orb(p);
  else if ( uKind < 1.5 ) c = spark(p);
  else if ( uKind < 2.5 ) c = mote(p);
  else if ( uKind < 3.5 ) c = flame(p);
  else if ( uKind < 4.5 ) c = shard(p);
  else if ( uKind < 5.5 ) c = rune(p);
  else if ( uKind < 6.5 ) c = vortex(p);
  else if ( uKind < 7.5 ) c = bubble(p);
  else c = aura(p);
  float border = (1.0 - smoothstep(0.86, 1.0, length(p))) * (1.0 - smoothstep(0.96, 1.0, max(abs(p0.x), abs(p0.y))));
  // Keep the output valid premultiplied colour (rgb <= alpha) so extracted images have clean edges
  vec4 o = clamp(c, 0.0, 1.0);
  o.a = max(o.a, max(o.r, max(o.g, o.b)));
  gl_FragColor = o * uAlpha * border;
}`;

/** "#rrggbb" → [r, g, b] in 0..1 */
function rgb(hex) {
  const s = String(hex ?? "#ffffff").replace(/^#/, "");
  const n = /^[0-9a-f]{6}$/i.test(s) ? parseInt(s, 16) : 0xffffff;
  return new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
}

/**
 * Uniform values for a preset's look.
 * @param {object} preset     A normalized particle preset
 * @param {number} time       Seconds
 */
export function uniformsFor(preset, time=0) {
  const L = preset.look;
  const pal = preset.palette;
  return {
    uTime: time,
    uSeed: (preset.seed % 1000) / 10,
    uKind: KINDS[preset.kind]?.id ?? 0,
    uC0: rgb(pal[0]),
    uC1: rgb(pal[1]),
    uC2: rgb(pal[2]),
    uC3: rgb(pal[3]),
    uSize: L.size,
    uScale: L.scale,
    uDetail: L.detail,
    uWarp: L.warp,
    uVeins: L.veins,
    uSwirl: L.swirl,
    uSpin: L.spin,
    uPulse: L.pulse,
    uPulseRate: L.pulseRate,
    uGlow: L.glow,
    uCore: L.core,
    uRim: L.rim,
    uSparkle: L.sparkle,
    uShape: L.shape,
    uAlpha: L.alpha,
    uMolded: preset.outline ? 1 : 0
  };
}

/**
 * The outline texture of one mesh: PROFILE_SIZE directions, rewritten in place when the outline changes.
 * @returns {{texture: PIXI.Texture, data: Uint8Array, key: string|null}}
 */
function profileTexture() {
  const data = new Uint8Array(PROFILE_SIZE * 4);
  const texture = PIXI.Texture.fromBuffer(data, PROFILE_SIZE, 1, {
    scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, wrapMode: PIXI.WRAP_MODES.CLAMP,
    alphaMode: PIXI.ALPHA_MODES.NPM
  });
  return {texture, data, key: null};
}

function setProfile(profile, outline) {
  const key = outlineKey(outline);
  if ( key === profile.key ) return;
  profile.key = key;
  encodeProfile(radialProfile(outline), profile.data);
  profile.texture.baseTexture.resource?.update?.();
}

let geometry = null;

/** A square mesh of `size` pixels painted by the particle shader. */
export function createParticleMesh(preset, size, time=0) {
  geometry ??= new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const profile = profileTexture();
  setProfile(profile, preset.outline);
  const shader = PIXI.Shader.from(VERTEX, FRAGMENT, {...uniformsFor(preset, time), uProfile: profile.texture});
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.scale.set(size, size);
  // The outline texture belongs to this mesh and goes with it
  mesh.kpeProfile = profile;
  const destroy = mesh.destroy.bind(mesh);
  mesh.destroy = options => {
    if ( !profile.texture.destroyed ) profile.texture.destroy(true);
    profile.texture.destroyed = true;
    return destroy(options);
  };
  return mesh;
}

/** Point a mesh at another preset (or just a new time) without recompiling. */
export function updateParticleMesh(mesh, preset, time=0) {
  Object.assign(mesh.shader.uniforms, uniformsFor(preset, time));
  if ( mesh.kpeProfile ) setProfile(mesh.kpeProfile, preset.outline);
}
