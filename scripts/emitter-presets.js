// Emitter presets: streams of short-lived particles (sparks, embers, dust, mist, fireflies, bursts) rendered by
// Foundry's ParticleGenerator. Purely visual and client-side; they follow tokens exactly, including animator motion.

import {BUILTIN_PRESETS} from "./presets.js";

export const EMITTER_FIELDS = {
  rate: {label: "Particles per second", min: 0, max: 200, step: 1},
  count: {label: "Most at once", min: 1, max: 600, step: 1},
  burst: {label: "Burst size", min: 0, max: 300, step: 1},
  lifeMin: {label: "Lifetime from (s)", min: 0.05, max: 10, step: 0.05},
  lifeMax: {label: "Lifetime to (s)", min: 0.05, max: 10, step: 0.05},
  speedMin: {label: "Speed from (sq/s)", min: 0, max: 20, step: 0.05},
  speedMax: {label: "Speed to (sq/s)", min: 0, max: 20, step: 0.05},
  angle: {label: "Direction (°)", min: -180, max: 180, step: 1},
  spread: {label: "Spread (°)", min: 0, max: 360, step: 1},
  gravity: {label: "Gravity (sq/s²)", min: -10, max: 10, step: 0.05},
  radius: {label: "Area radius (sq)", min: 0, max: 50, step: 0.05},
  sizeMin: {label: "Size from (sq)", min: 0.01, max: 3, step: 0.01},
  sizeMax: {label: "Size to (sq)", min: 0.01, max: 3, step: 0.01},
  grow: {label: "Grow over life (×)", min: 0, max: 4, step: 0.05},
  alphaMin: {label: "Opacity from", min: 0, max: 1, step: 0.01},
  alphaMax: {label: "Opacity to", min: 0, max: 1, step: 0.01},
  fadeIn: {label: "Fade in (of life)", min: 0, max: 0.9, step: 0.01},
  fadeOut: {label: "Fade out (of life)", min: 0, max: 0.95, step: 0.01},
  spin: {label: "Spin (°/s)", min: 0, max: 1440, step: 5},
  orbitSpeed: {label: "Orbit speed (°/s)", min: 0, max: 720, step: 5}
};

export const AREAS = {point: "A point", circle: "Inside a circle", ring: "On a ring", token: "Over the token"};
export const BEHAVIORS = {drift: "Drift away", orbit: "Orbit the source", follow: "Stick to the source"};
export const BLENDS = {add: "Glow (additive)", screen: "Soft light (screen)", normal: "Normal"};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Fill in and clamp an emitter preset. */
export function normalizeEmitter(e={}) {
  const out = {
    id: typeof e.id === "string" ? e.id : null,
    name: String(e.name ?? "Emitter"),
    description: String(e.description ?? ""),
    category: typeof e.category === "string" ? e.category : "mine",
    builtin: !!e.builtin,
    // A particle preset id, an inline preset, or "inherit" (use the colours of the token it is attached to)
    particle: e.particle ?? "builtin-spark",
    area: e.area in AREAS ? e.area : "point",
    behavior: e.behavior in BEHAVIORS ? e.behavior : "drift",
    blend: e.blend in BLENDS ? e.blend : "add",
    oneShot: !!e.oneShot
  };
  const defaults = {rate: 20, count: 80, burst: 0, lifeMin: 0.5, lifeMax: 1.2, speedMin: 0.2, speedMax: 0.8, angle: 0, spread: 360,
    gravity: 0, radius: 0.2, sizeMin: 0.1, sizeMax: 0.2, grow: 1, alphaMin: 0.7, alphaMax: 1, fadeIn: 0.1, fadeOut: 0.5, spin: 0,
    orbitSpeed: 60};
  for ( const [k, f] of Object.entries(EMITTER_FIELDS) ) out[k] = clamp(num(e[k], defaults[k]), f.min, f.max);
  if ( out.lifeMax < out.lifeMin ) out.lifeMax = out.lifeMin;
  if ( out.speedMax < out.speedMin ) out.speedMax = out.speedMin;
  if ( out.sizeMax < out.sizeMin ) out.sizeMax = out.sizeMin;
  if ( out.alphaMax < out.alphaMin ) out.alphaMax = out.alphaMin;
  return out;
}

const em = (id, name, description, data) => normalizeEmitter({id: `builtin-${id}`, builtin: true, category: "emitters", name, description, ...data});

export const BUILTIN_EMITTERS = [
  em("spark-trail", "Spark trail", "Bright sparks shed behind whatever moves — perfect on flying orbs and missiles.", {
    particle: "inherit", rate: 45, count: 120, lifeMin: 0.25, lifeMax: 0.7, speedMin: 0.1, speedMax: 0.7, radius: 0.08,
    sizeMin: 0.08, sizeMax: 0.18, grow: 0.3, fadeIn: 0.05, fadeOut: 0.6, area: "circle"
  }),
  em("embers", "Rising embers", "Glowing embers drifting up from a fire or a burning creature.", {
    particle: "builtin-ember", rate: 10, count: 60, lifeMin: 1.2, lifeMax: 2.6, speedMin: 0.2, speedMax: 0.6, angle: -90, spread: 50,
    gravity: -0.15, radius: 0.45, area: "circle", sizeMin: 0.06, sizeMax: 0.14, grow: 0.5, fadeOut: 0.6
  }),
  em("magic-dust", "Magic dust", "Twinkling motes hanging in the air.", {
    particle: "inherit", rate: 14, count: 60, lifeMin: 0.7, lifeMax: 1.6, speedMin: 0.02, speedMax: 0.15, radius: 0.7, area: "circle",
    sizeMin: 0.06, sizeMax: 0.16, fadeIn: 0.3, fadeOut: 0.5
  }),
  em("fireflies", "Fireflies", "Lazy lights circling the source.", {
    particle: "builtin-firefly", rate: 3, count: 14, lifeMin: 3, lifeMax: 6, speedMin: 0, speedMax: 0.05, radius: 1.4, area: "ring",
    behavior: "orbit", orbitSpeed: 40, sizeMin: 0.12, sizeMax: 0.22, fadeIn: 0.25, fadeOut: 0.3, blend: "add"
  }),
  em("frost-mist", "Frost mist", "Cold vapour spilling outward.", {
    particle: "builtin-mist-puff", rate: 6, count: 30, lifeMin: 1.6, lifeMax: 3, speedMin: 0.1, speedMax: 0.3, radius: 0.5, area: "ring",
    sizeMin: 0.35, sizeMax: 0.6, grow: 1.8, alphaMin: 0.12, alphaMax: 0.25, fadeIn: 0.3, fadeOut: 0.6, blend: "screen"
  }),
  em("smoke", "Smoke", "Dark smoke rising and spreading.", {
    particle: "builtin-smoke-puff", rate: 5, count: 30, lifeMin: 2, lifeMax: 3.5, speedMin: 0.15, speedMax: 0.35, angle: -90, spread: 40,
    radius: 0.3, area: "circle", sizeMin: 0.4, sizeMax: 0.7, grow: 2.2, alphaMin: 0.15, alphaMax: 0.3, fadeIn: 0.2, fadeOut: 0.6,
    blend: "normal", spin: 30
  }),
  em("holy-motes", "Rising light", "Motes of radiance floating upward.", {
    particle: "builtin-holy-mote", rate: 8, count: 40, lifeMin: 1.2, lifeMax: 2.2, speedMin: 0.2, speedMax: 0.5, angle: -90, spread: 30,
    radius: 0.5, area: "circle", sizeMin: 0.08, sizeMax: 0.16, fadeIn: 0.25, fadeOut: 0.5
  }),
  em("bubbles", "Bubbles", "Rainbow bubbles drifting up.", {
    particle: "builtin-soap-bubble", rate: 3, count: 20, lifeMin: 1.5, lifeMax: 3, speedMin: 0.15, speedMax: 0.35, angle: -90, spread: 40,
    radius: 0.4, area: "circle", sizeMin: 0.1, sizeMax: 0.25, alphaMin: 0.7, alphaMax: 0.9, blend: "normal"
  }),
  em("embers-orbit", "Orbiting sparks", "Sparks swirling around the source.", {
    particle: "inherit", rate: 20, count: 60, lifeMin: 0.8, lifeMax: 1.6, speedMin: 0, speedMax: 0.1, radius: 0.8, area: "ring",
    behavior: "orbit", orbitSpeed: 220, sizeMin: 0.06, sizeMax: 0.14, fadeIn: 0.15, fadeOut: 0.5
  }),
  em("impact", "Impact burst", "A one-off spray of sparks — impacts, hits, pops.", {
    particle: "inherit", oneShot: true, burst: 40, rate: 0, count: 80, lifeMin: 0.25, lifeMax: 0.6, speedMin: 2, speedMax: 6, radius: 0.05,
    area: "circle", sizeMin: 0.06, sizeMax: 0.16, grow: 0.4, fadeOut: 0.6, gravity: 0
  }),
  em("explosion", "Explosion", "A blast of fire and embers.", {
    particle: "builtin-fire-puff", oneShot: true, burst: 60, rate: 0, count: 120, lifeMin: 0.35, lifeMax: 0.9, speedMin: 1.5, speedMax: 5,
    radius: 0.2, area: "circle", sizeMin: 0.15, sizeMax: 0.45, grow: 1.6, fadeIn: 0.02, fadeOut: 0.7, gravity: -0.4
  }),
  em("frost-burst", "Frost burst", "Ice glitter scattering outward.", {
    particle: "builtin-star", oneShot: true, burst: 50, rate: 0, count: 80, lifeMin: 0.4, lifeMax: 1, speedMin: 1, speedMax: 4, radius: 0.1,
    area: "circle", sizeMin: 0.06, sizeMax: 0.18, fadeOut: 0.7, spin: 180
  }),
  em("blood-drips", "Blood drips", "Drops falling under gravity.", {
    particle: "builtin-blood-orb", rate: 4, count: 20, lifeMin: 0.6, lifeMax: 1.1, speedMin: 0, speedMax: 0.3, angle: 90, spread: 60,
    gravity: 3, radius: 0.3, area: "circle", sizeMin: 0.05, sizeMax: 0.09, blend: "normal"
  })
];

/** A particle preset by id (built-in only; the library resolves user presets). */
export function builtinParticle(id) {
  return BUILTIN_PRESETS.find(p => p.id === id) ?? null;
}
