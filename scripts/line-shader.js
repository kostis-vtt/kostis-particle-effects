// The effect-wall shader: paints a style (fire, chains, lightning, frost, thorns, runes, force, shadow, water, beam)
// along a ribbon mesh. u runs along the wall in pixels, v across it from -1 to 1. Only the revealed window shows.

export const LINE_STYLES = {
  fire: {id: 0, label: "Fire", icon: "fa-solid fa-fire"},
  chains: {id: 1, label: "Chains", icon: "fa-solid fa-link"},
  lightning: {id: 2, label: "Lightning", icon: "fa-solid fa-bolt"},
  frost: {id: 3, label: "Ice", icon: "fa-solid fa-snowflake"},
  thorns: {id: 4, label: "Thorns", icon: "fa-solid fa-seedling"},
  runes: {id: 5, label: "Runes", icon: "fa-solid fa-dharmachakra"},
  force: {id: 6, label: "Force field", icon: "fa-solid fa-shield-halved"},
  shadow: {id: 7, label: "Shadow / smoke", icon: "fa-solid fa-smog"},
  water: {id: 8, label: "Water", icon: "fa-solid fa-water"},
  beam: {id: 9, label: "Beam", icon: "fa-solid fa-wand-magic"}
};

/** How far the mesh reaches beyond the wall's band, for glow (multiple of the half width). */
export const PAD = 1.8;

/**
 * Shader time in seconds, wrapped: float32 maths in the noise loses its precision as time grows (patterns would
 * stutter and freeze after a few hours). Once every LINE_TIME_WRAP seconds the patterns jump once.
 */
export const LINE_TIME_WRAP = 1200;
export const lineTime = () => (performance.now() / 1000) % LINE_TIME_WRAP;

export const LINE_VERTEX = `
attribute vec2 aVertexPosition;
attribute vec2 aUv;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const LINE_FRAGMENT = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uStyle;
uniform float uSeed;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uWidth;
uniform float uScale;
uniform float uSpeed;
uniform float uIntensity;
uniform float uGlow;
uniform float uAlpha;
uniform float uPad;
uniform float uLength;
uniform float uClosed;
uniform float uRevA;
uniform float uRevSpan;
uniform float uTaper;
uniform float uFront;
uniform float uBack;

float sq(float x) {
  return x * x;
}

// Small multipliers keep the products well inside float32 precision for large coordinates
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.0));
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i++ ) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
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

/* Fire: flames licking outward from the line, flickering. */
vec4 fire(float s, float b, float t) {
  float ab = abs(b);
  float n = fbm(vec2(s * 1.6, ab * 1.7 - t * 2.2) + uSeed);
  float n2 = fbm(vec2(s * 3.4 + 5.0, ab * 3.2 - t * 3.1));
  float h = 0.62 + (0.55 * n) + (0.22 * n2);
  float heat = 1.0 - (ab / max(h, 0.05)) + (0.22 * n2);
  float body = smoothstep(0.0, 0.32, heat);
  vec3 c = ramp(clamp(heat * 1.05 + 0.08, 0.0, 1.0));
  float glow = uGlow * exp(-ab * ab * 1.4) * 0.5;
  float A = clamp(body + glow * (1.0 - body), 0.0, 1.0);
  return vec4(c * body + ramp(0.55) * glow * (1.0 - body), A * 0.9);
}

/* Chains: interlocking links (face-on rings and edge-on bars), metallic, sliding along, with a glow. */
float ringMask(vec2 q) {
  float d = abs(length(q / vec2(0.68, 0.5)) - 1.0);
  return 1.0 - smoothstep(0.17, 0.26, d);
}

vec4 chains(float s, float b, float t) {
  float q = s * 1.15 - t * 0.6;
  float k = floor(q);
  float mask = 0.0;
  float shade = 0.0;
  for ( int j = -1; j <= 1; j++ ) {
    float idx = k + float(j);
    float x = q - (idx + 0.5);
    vec2 p = vec2(x * 1.25, b / 0.9);
    float m;
    float sh;
    if ( mod(idx, 2.0) < 0.5 ) {
      m = ringMask(p);
      sh = 0.55 + 0.45 * cos(atan(p.y, p.x) * 2.0 + 0.8);
    } else {
      float bar = max(abs(p.x) - 0.62, 0.0);
      float d = length(vec2(bar, p.y));
      m = 1.0 - smoothstep(0.13, 0.2, d);
      sh = 0.7 + 0.3 * (1.0 - abs(p.y) / 0.2);
    }
    if ( m > mask ) {
      mask = m;
      shade = sh;
    }
  }
  float spec = pow(max(shade, 0.0), 6.0);
  vec3 c = ramp(0.45 + 0.4 * shade) + ramp(1.0) * spec * 0.6;
  float pulse = 0.75 + 0.25 * sin(t * 2.5 + s * 0.8);
  float glow = uGlow * exp(-b * b * 2.2) * 0.65 * pulse;
  float A = clamp(mask + glow * (1.0 - mask), 0.0, 1.0);
  return vec4(c * mask + ramp(0.8) * glow * (1.0 - mask), A);
}

/* Lightning: jagged crackling bolts that re-strike several times a second. */
vec4 lightning(float s, float b, float t) {
  float frame = mod(floor(t * 9.0), 4096.0);
  float flick = 0.6 + 0.4 * step(0.3, hash21(vec2(frame, uSeed)));
  float y1 = fbm(vec2(s * 2.2, frame * 1.7 + uSeed)) * 0.9;
  float y2 = fbm(vec2(s * 4.1 + 3.0, frame * 2.9)) * 0.7;
  float d1 = abs(b - y1);
  float d2 = abs(b - y2);
  float core = exp(-d1 * d1 * 160.0) + 0.55 * exp(-d2 * d2 * 260.0);
  float glow = uGlow * (0.55 * exp(-d1 * d1 * 7.0) + 0.2 * exp(-b * b * 2.0));
  float I = clamp((core * 1.6 + glow) * flick, 0.0, 1.0);
  vec3 c = mix(ramp(0.6), ramp(1.0), clamp(core, 0.0, 1.0));
  return vec4(c * I, I * 0.75);
}

/* Ice: a jagged crystalline band with facets, glints and a cold glow. */
vec4 frost(float s, float b, float t) {
  float edge = 0.7 + 0.3 * vnoise(vec2(s * 3.0, uSeed));
  float ab = abs(b);
  float inside = 1.0 - smoothstep(edge - 0.06, edge, ab);
  vec2 g = vec2(s * 2.6, b * 2.2 + s * 0.7);
  vec2 cell = floor(g);
  float f = hash21(cell + uSeed);
  float f2 = hash21(cell + 3.1);
  float facet = 0.35 + 0.45 * f + 0.2 * (fract(g.x + g.y) - 0.5);
  float glint = pow(max(0.0, sin(t * 2.0 + f2 * 30.0)), 30.0);
  vec3 c = ramp(clamp(facet + 0.25 * (1.0 - ab), 0.0, 1.0)) + ramp(1.0) * glint * 0.9;
  float rim = smoothstep(edge - 0.18, edge - 0.04, ab) * inside;
  c += ramp(1.0) * rim * 0.5;
  float glow = uGlow * exp(-max(ab - edge, 0.0) * 6.0) * (1.0 - inside) * 0.5;
  return vec4(c * inside + ramp(0.75) * glow, clamp(inside * 0.95 + glow, 0.0, 1.0));
}

/* Thorns: two twisting vines with spikes and the odd leaf. */
vec4 thorns(float s, float b, float t) {
  float sway = 0.04 * sin(t * 1.3 + s);
  float y1 = 0.22 * sin(s * 2.4 + uSeed) + sway;
  float y2 = 0.22 * sin(s * 2.4 + uSeed + 3.14159) - sway;
  float vine = max(1.0 - smoothstep(0.07, 0.12, abs(b - y1)), 1.0 - smoothstep(0.07, 0.12, abs(b - y2)));
  float cell = floor(s * 2.2);
  float x = fract(s * 2.2) - 0.5;
  float side = mod(cell, 2.0) < 0.5 ? 1.0 : -1.0;
  float base = mix(y1, y2, step(0.5, hash21(vec2(cell, 2.0))));
  float spikeLen = 0.35 + 0.35 * hash21(vec2(cell, 7.0));
  float along = (b - base) * side;
  float spike = step(0.0, along) * (1.0 - smoothstep(0.0, 0.03, abs(x) - 0.12 * (1.0 - along / spikeLen))) * step(along, spikeLen);
  float leafC = hash21(vec2(cell, 11.0));
  vec2 lp = vec2(x * 3.0, (b - base + side * 0.25) * 5.0);
  float leaf = step(0.6, leafC) * (1.0 - smoothstep(0.8, 1.0, length(lp)));
  float m = clamp(max(max(vine, spike), leaf), 0.0, 1.0);
  vec3 c = vine >= max(spike, leaf) ? ramp(0.35 + 0.2 * vnoise(vec2(s * 8.0, b * 8.0))) : (spike >= leaf ? ramp(0.75) : ramp(0.55));
  float glow = uGlow * exp(-b * b * 3.0) * 0.25;
  return vec4(c * m + ramp(0.5) * glow * (1.0 - m), clamp(m + glow * (1.0 - m), 0.0, 1.0));
}

/* Runes: a glowing band of glyphs between two rails, slowly drifting. */
vec4 runes(float s, float b, float t) {
  float ab = abs(b);
  float rails = exp(-sq((ab - 0.85) / 0.05)) + 0.6 * exp(-sq((ab - 0.98) / 0.03));
  float q = s * 2.6 - t * 0.35;
  float cell = floor(q);
  float fx = fract(q);
  float h1 = hash21(vec2(cell, uSeed));
  float h2 = hash21(vec2(cell, uSeed + 1.0));
  float h3 = hash21(vec2(cell, uSeed + 2.0));
  float y = b / 0.7;
  float g = 0.0;
  g += step(0.25, h1) * exp(-sq((fx - 0.5) / 0.06)) * step(abs(y), 0.75);
  g += step(0.45, h2) * exp(-sq((y - (h2 * 1.2 - 0.6)) / 0.1)) * step(0.2, fx) * step(fx, 0.8);
  g += step(0.6, h3) * exp(-sq(((fx - 0.5) - y * 0.35) / 0.06)) * step(abs(y), 0.7);
  g *= step(ab, 0.8);
  float pulse = 0.75 + 0.25 * sin(t * 2.0 + cell * 0.7);
  float I = clamp((rails + g) * pulse, 0.0, 1.0);
  float glow = uGlow * exp(-b * b * 1.5) * 0.25;
  vec3 c = ramp(0.6 + 0.4 * I);
  return vec4(c * I + ramp(0.6) * glow, clamp(max(I, glow), 0.0, 1.0) * 0.85);
}

/* Force field: a translucent shimmering sheet with hex cells and bright edges. */
vec4 force(float s, float b, float t) {
  float ab = abs(b);
  float inside = 1.0 - smoothstep(0.95, 1.0, ab);
  vec2 h = vec2(s * 3.0, b * 1.7);
  h.x *= 1.1547;
  h.y += mod(floor(h.x), 2.0) * 0.5;
  vec2 g = abs(fract(h) - 0.5);
  float cellEdge = abs(max(g.x * 1.5 + g.y, g.y * 2.0) - 1.0);
  float hex = (1.0 - smoothstep(0.0, 0.08, cellEdge)) * (0.4 + 0.6 * (0.5 + 0.5 * sin(t * 2.0 + s * 2.0)));
  float sheen = pow(0.5 + 0.5 * sin(s * 2.5 - t * 3.0), 8.0);
  float edge = pow(ab, 6.0);
  float A = clamp(0.12 + edge * 0.8 + hex * 0.45 + sheen * 0.25, 0.0, 1.0) * inside;
  vec3 c = ramp(0.55 + 0.45 * (edge + hex));
  float glow = uGlow * exp(-max(ab - 0.9, 0.0) * 8.0) * (1.0 - inside) * 0.5;
  return vec4(c * A + ramp(0.85) * glow, clamp(A + glow, 0.0, 1.0));
}

/* Shadow or smoke: dense swirling darkness with a ragged edge (normal blend, it darkens what's below). */
vec4 shadow(float s, float b, float t) {
  vec2 p = vec2(s * 1.2, b * 1.4);
  float w = fbm(p + vec2(t * 0.3, -t * 0.2) + uSeed);
  float n = fbm(p * 1.7 + w * 1.4 + vec2(-t * 0.25, t * 0.15));
  float edge = 0.75 + 0.3 * n;
  float A = (1.0 - smoothstep(edge - 0.35, edge, abs(b))) * (0.75 + 0.25 * n);
  vec3 c = ramp(clamp(0.25 + 0.5 * (n * 0.5 + 0.5) * (1.0 - abs(b)), 0.0, 1.0));
  A = clamp(A, 0.0, 1.0);
  return vec4(c * A, A);
}

/* Water: a flowing stream with caustic light and foaming banks. */
vec4 water(float s, float b, float t) {
  float ab = abs(b);
  float bank = 0.8 + 0.12 * vnoise(vec2(s * 2.0, uSeed));
  float inside = 1.0 - smoothstep(bank - 0.05, bank, ab);
  vec2 p = vec2(s * 1.5 - t * 1.2, b * 1.3);
  float n = fbm(p);
  float caustic = pow(abs(sin((fbm(p * 2.0 + n) + t * 0.5) * 6.0)), 8.0);
  float foam = smoothstep(bank - 0.25, bank - 0.05, ab) * (0.5 + 0.5 * vnoise(vec2(s * 6.0 - t * 2.0, b * 6.0)));
  vec3 c = ramp(0.35 + 0.25 * n + 0.2 * (1.0 - ab)) + ramp(1.0) * (caustic * 0.35 + foam * 0.6);
  return vec4(c * inside, inside * 0.9);
}

/* Beam: a hot core with a soft glow and a fast shimmer along it. */
vec4 beam(float s, float b, float t) {
  float shimmer = 0.85 + 0.15 * sin(s * 18.0 - t * 30.0);
  float core = exp(-b * b * 40.0) * shimmer;
  float glow = uGlow * exp(-b * b * 2.5) * 0.7;
  float I = clamp(core + glow, 0.0, 1.0);
  vec3 c = mix(ramp(0.6), ramp(1.0), clamp(core * 1.2, 0.0, 1.0));
  return vec4(c * I, I * 0.8);
}

/* How much of the wall is revealed at u (soft-edged window, wrapping round loops). */
float windowAt(float d, float span, float feather) {
  return clamp(min(d, span - d) / feather + 1.0, 0.0, 1.0);
}

void main() {
  float u = vUv.x;
  float b = vUv.y * uPad;
  float t = uTime * uSpeed;
  float s = u / max(uWidth * uScale, 1.0);
  vec4 c;
  if ( uStyle < 0.5 ) c = fire(s, b, t);
  else if ( uStyle < 1.5 ) c = chains(s, b, t);
  else if ( uStyle < 2.5 ) c = lightning(s, b, t);
  else if ( uStyle < 3.5 ) c = frost(s, b, t);
  else if ( uStyle < 4.5 ) c = thorns(s, b, t);
  else if ( uStyle < 5.5 ) c = runes(s, b, t);
  else if ( uStyle < 6.5 ) c = force(s, b, t);
  else if ( uStyle < 7.5 ) c = shadow(s, b, t);
  else if ( uStyle < 8.5 ) c = water(s, b, t);
  else c = beam(s, b, t);

  // Reveal window
  float span = clamp(uRevSpan, 0.0, uLength);
  float feather = max(uWidth * 0.6, 4.0);
  float m;
  float d;
  float whole = 0.0;
  if ( (uClosed > 0.5) && (span >= uLength - 0.5) ) {
    m = 1.0;
    d = span;
    whole = 1.0;
  } else if ( uClosed > 0.5 ) {
    d = mod(u - uRevA, uLength);
    m = max(windowAt(d, span, feather), windowAt(d - uLength, span, feather));
  } else {
    d = u - uRevA;
    m = windowAt(d, span, feather);
  }
  // Trails fade towards their tail; the leading edge flares (uBack: the window moves towards the path's start).
  // A whole loop has neither.
  float f = span > 0.0 ? clamp(d / span, 0.0, 1.0) : 1.0;
  if ( uBack > 0.5 ) f = 1.0 - f;
  m *= mix(1.0, f, abs(uTaper) * (1.0 - whole));
  float headD = uBack > 0.5 ? d : (span - d);
  float flare = (1.0 - whole) * uFront * exp(-sq(headD / feather)) * step(-feather, d) * step(d, span + feather);
  c.rgb += ramp(1.0) * flare * 0.6 * c.a;

  // Fade out to nothing at the outer edge of the mesh
  float outer = 1.0 - smoothstep(uPad * 0.8, uPad, abs(b));
  gl_FragColor = clamp(c * m * outer * uIntensity, 0.0, 1.0) * uAlpha;
}`;

/** "#rrggbb" → [r, g, b] in 0..1 */
function rgb(hex) {
  const s = String(hex ?? "#ffffff").replace(/^#/, "");
  const n = /^[0-9a-f]{6}$/i.test(s) ? parseInt(s, 16) : 0xffffff;
  return new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
}

/**
 * Uniforms for a wall look.
 * @param {object} look      {style, palette, width (px), scale, speed, intensity, glow, alpha, seed}
 * @param {object} reveal    {a, span, alpha, taper, front, back} from revealWindow
 * @param {object} track     {length, closed}
 * @param {number} time      Seconds
 */
export function lineUniforms(look, reveal, track, time=0) {
  const pal = look.palette;
  return {
    uTime: time,
    uStyle: LINE_STYLES[look.style]?.id ?? 0,
    uSeed: ((look.seed ?? 1) % 1000) / 37,
    uC0: rgb(pal[0]),
    uC1: rgb(pal[1]),
    uC2: rgb(pal[2]),
    uC3: rgb(pal[3]),
    uWidth: look.widthPx,
    uScale: look.scale,
    uSpeed: look.speed,
    uIntensity: look.intensity,
    uGlow: look.glow,
    uAlpha: look.alpha * (reveal?.alpha ?? 1),
    uPad: PAD,
    uLength: Math.max(1, track.length),
    uClosed: track.closed ? 1 : 0,
    uRevA: reveal?.a ?? 0,
    uRevSpan: reveal?.span ?? track.length,
    uTaper: reveal?.taper ?? 0,
    uFront: reveal?.front ?? 0,
    uBack: reveal?.back ? 1 : 0
  };
}
