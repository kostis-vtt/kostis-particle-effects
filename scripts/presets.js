// Particle presets: what a particle looks like (kind, palette, look numbers) and how it lives on the map as a
// token (size, rotation, light). Built-ins below; users save their own in the world library.

import {KINDS} from "./shader.js";
import {normalizeOutline} from "./outline.js";

export const CATEGORIES = {
  orbs: {label: "Orbs", icon: "fa-solid fa-circle"},
  sparks: {label: "Sparks & motes", icon: "fa-solid fa-star"},
  flames: {label: "Flames & wisps", icon: "fa-solid fa-fire"},
  crystals: {label: "Crystals", icon: "fa-solid fa-gem"},
  runes: {label: "Runes & portals", icon: "fa-solid fa-dharmachakra"},
  shields: {label: "Shields", icon: "fa-solid fa-shield-halved"},
  auras: {label: "Auras", icon: "fa-solid fa-sun"},
  mine: {label: "My particles", icon: "fa-solid fa-bookmark"}
};

/** Sensible starting look per kind. */
export const KIND_DEFAULTS = {
  orb: {size: 0.62, scale: 2.2, detail: 5, warp: 1.2, veins: 0, swirl: 0.35, spin: 0.4, pulse: 0.4, pulseRate: 0.6,
    glow: 0.6, core: 0.6, rim: 0.6, sparkle: 0, shape: 4, alpha: 1},
  spark: {size: 0.5, scale: 2, detail: 3, warp: 0, veins: 0, swirl: 0.5, spin: 0.6, pulse: 0.6, pulseRate: 1.5,
    glow: 0.6, core: 1, rim: 0, sparkle: 0, shape: 4, alpha: 1},
  mote: {size: 0.35, scale: 3, detail: 4, warp: 0, veins: 0, swirl: 0.6, spin: 0, pulse: 0.5, pulseRate: 0.8,
    glow: 0.7, core: 0.6, rim: 0, sparkle: 0, shape: 4, alpha: 1},
  flame: {size: 0.6, scale: 3, detail: 5, warp: 0, veins: 0, swirl: 0.8, spin: 0, pulse: 0.4, pulseRate: 2,
    glow: 0.6, core: 0.6, rim: 0, sparkle: 0, shape: 4, alpha: 1},
  shard: {size: 0.85, scale: 3, detail: 4, warp: 0, veins: 0, swirl: 0.3, spin: 0, pulse: 0, pulseRate: 1,
    glow: 0.5, core: 0.4, rim: 0.7, sparkle: 0.6, shape: 6, alpha: 1},
  rune: {size: 0.82, scale: 2, detail: 3, warp: 0, veins: 0, swirl: 0.2, spin: 0.25, pulse: 0.4, pulseRate: 0.5,
    glow: 0.6, core: 0, rim: 0, sparkle: 0, shape: 5, alpha: 1},
  vortex: {size: 0.85, scale: 2.5, detail: 4, warp: 0.6, veins: 0, swirl: 0.4, spin: 1.5, pulse: 0.2, pulseRate: 0.5,
    glow: 0.6, core: 0, rim: 0.8, sparkle: 0, shape: 3, alpha: 1},
  bubble: {size: 0.78, scale: 2, detail: 3, warp: 0, veins: 0, swirl: 0.3, spin: 0, pulse: 0.3, pulseRate: 0.6,
    glow: 0.4, core: 0, rim: 0.7, sparkle: 0.5, shape: 6, alpha: 1},
  aura: {size: 0.5, scale: 3, detail: 4, warp: 0, veins: 0, swirl: 0.6, spin: 0, pulse: 0.3, pulseRate: 0.5,
    glow: 0.4, core: 0, rim: 0.5, sparkle: 0.4, shape: 4, alpha: 1}
};

/** Ranges for the editor sliders (and for clamping). */
export const LOOK_FIELDS = {
  size: {label: "Body size", min: 0.1, max: 0.95, step: 0.01},
  scale: {label: "Pattern scale", min: 0.3, max: 8, step: 0.05},
  detail: {label: "Detail", min: 1, max: 6, step: 1},
  warp: {label: "Swirl distortion", min: 0, max: 3, step: 0.05},
  veins: {label: "Veins / cells", min: 0, max: 1, step: 0.01},
  swirl: {label: "Flow speed", min: 0, max: 3, step: 0.01},
  spin: {label: "Spin speed", min: -6, max: 6, step: 0.05},
  pulse: {label: "Pulse", min: 0, max: 1, step: 0.01},
  pulseRate: {label: "Pulse rate (Hz)", min: 0, max: 6, step: 0.05},
  glow: {label: "Glow", min: 0, max: 1, step: 0.01},
  core: {label: "Core light", min: 0, max: 1.5, step: 0.01},
  rim: {label: "Rim light", min: 0, max: 1.5, step: 0.01},
  sparkle: {label: "Sparkle", min: 0, max: 1, step: 0.01},
  shape: {label: "Points / sides", min: 1, max: 12, step: 1},
  alpha: {label: "Opacity", min: 0.05, max: 1, step: 0.01}
};

/** Token defaults per kind: size in grid squares, whether the art turns with the token, and light. */
const TOKEN_DEFAULTS = {
  orb: {size: 0.6, lockRotation: true, light: 2},
  spark: {size: 0.3, lockRotation: true, light: 0},
  mote: {size: 0.3, lockRotation: true, light: 1},
  flame: {size: 0.6, lockRotation: false, light: 2},
  shard: {size: 0.5, lockRotation: false, light: 0},
  rune: {size: 2, lockRotation: true, light: 2},
  vortex: {size: 2, lockRotation: true, light: 3},
  bubble: {size: 1.5, lockRotation: true, light: 0},
  aura: {size: 2, lockRotation: true, light: 0}
};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;

/** Fill in and clamp a preset so every consumer can trust it. */
export function normalizePreset(p={}) {
  const kind = p.kind in KINDS ? p.kind : "orb";
  const base = KIND_DEFAULTS[kind];
  const look = {};
  for ( const [k, f] of Object.entries(LOOK_FIELDS) ) look[k] = clamp(num(p.look?.[k], base[k]), f.min, f.max);
  const td = TOKEN_DEFAULTS[kind];
  const palette = Array.from({length: 4}, (_, i) => (HEX.test(p.palette?.[i] ?? "") ? p.palette[i].toLowerCase() : ["#1a0b3d", "#5b2bd6", "#b46cff", "#f3d9ff"][i]));
  const light = p.token?.light ?? {};
  return {
    id: typeof p.id === "string" ? p.id : null,
    name: String(p.name ?? KINDS[kind].label),
    description: String(p.description ?? ""),
    category: typeof p.category === "string" ? p.category : "mine",
    builtin: !!p.builtin,
    kind,
    palette,
    seed: Math.abs(Math.round(num(p.seed, 1))) % 100000,
    look,
    // Molded into a shape (null: the usual circle)
    outline: normalizeOutline(p.outline),
    token: {
      size: clamp(num(p.token?.size, td.size), 0.1, 100),
      lockRotation: typeof p.token?.lockRotation === "boolean" ? p.token.lockRotation : td.lockRotation,
      light: {
        radius: clamp(num(light.radius, td.light), 0, 60),
        intensity: clamp(num(light.intensity, 0.5), 0, 1),
        animation: ["none", "pulse", "torch", "flame", "wave", "fog", "energy"].includes(light.animation) ? light.animation : "pulse"
      }
    },
    res: [128, 256, 512].includes(p.res) ? p.res : (["rune", "vortex", "aura", "bubble"].includes(kind) ? 512 : (["spark", "mote"].includes(kind) ? 128 : 256))
  };
}

/** The visual part of a preset (what the generated image depends on). */
export function visualKey(p) {
  const key = [p.kind, p.palette, p.seed, p.look, p.res];
  // (Unmolded looks keep the key they always had, so their baked images stay valid)
  if ( p.outline ) key.push(p.outline);
  return JSON.stringify(key);
}

const P = {
  arcane: ["#1a0b3d", "#5b2bd6", "#b46cff", "#f3d9ff"],
  fire: ["#2a0500", "#c52a00", "#ff8a1f", "#fff2b0"],
  frost: ["#04142e", "#1d6fd1", "#7fd8ff", "#f2fdff"],
  void: ["#020005", "#2d0a4e", "#8a2be2", "#ff7bf2"],
  nature: ["#061a05", "#2f7d1e", "#9be05a", "#f4ffd1"],
  electric: ["#020a24", "#1f5bff", "#67e8ff", "#ffffff"],
  holy: ["#3a2600", "#d99a00", "#ffe27a", "#fffdf0"],
  poison: ["#0b1a00", "#4f9b00", "#c6ff3d", "#f6ffd6"],
  water: ["#001a2c", "#0067a3", "#3cc4e6", "#e3fbff"],
  blood: ["#1a0003", "#7a0010", "#e0213b", "#ffc2c8"],
  shadow: ["#000000", "#16141f", "#4a4560", "#a59fc4"],
  sun: ["#3d1200", "#ff6a00", "#ffd000", "#fffbe0"],
  ember: ["#120400", "#7a1c00", "#ff5a1f", "#ffd27a"],
  toxic: ["#00140c", "#00805a", "#2bffb1", "#e0fff4"],
  rose: ["#24000f", "#a3215f", "#ff6fb0", "#ffe3f0"],
  gold: ["#2b1a00", "#a46b00", "#ffc83d", "#fff6cf"],
  ghost: ["#05141a", "#2a6f80", "#9ff3ff", "#ffffff"],
  moon: ["#14161f", "#5d6375", "#c9cede", "#ffffff"]
};

const pre = (id, category, name, kind, palette, look={}, extra={}) => ({
  id: `builtin-${id}`, builtin: true, category, name, kind, palette, look, seed: extra.seed ?? (id.length * 37), ...extra
});

export const BUILTIN_PRESETS = [
  /* Orbs */
  pre("arcane-orb", "orbs", "Arcane orb", "orb", P.arcane, {warp: 1.4, sparkle: 0.4}, {description: "Swirling violet energy with drifting stars."}),
  pre("fireball", "orbs", "Fireball", "orb", P.fire, {warp: 1.8, swirl: 0.8, veins: 0.35, core: 0.9, glow: 0.8, pulse: 0.6, pulseRate: 1.4}, {description: "A roiling ball of flame with lava veins.", token: {light: {radius: 3, animation: "torch"}}}),
  pre("frost-orb", "orbs", "Frost orb", "orb", P.frost, {warp: 0.8, swirl: 0.15, sparkle: 0.7, rim: 1, core: 0.4}, {description: "Icy, glittering, slow."}),
  pre("void-orb", "orbs", "Void orb", "orb", P.void, {warp: 2.4, swirl: 0.5, core: 0.1, rim: 1.2, glow: 0.7}, {description: "Dark matter with a burning rim."}),
  pre("storm-orb", "orbs", "Storm orb", "orb", P.electric, {warp: 1, swirl: 1.2, veins: 0.9, core: 0.5, pulse: 0.7, pulseRate: 3}, {description: "Crackling with lightning veins.", token: {light: {radius: 3, animation: "energy"}}}),
  pre("nature-orb", "orbs", "Life seed", "orb", P.nature, {warp: 1.6, swirl: 0.25, sparkle: 0.5, core: 0.7}, {description: "Green, growing, gently glowing."}),
  pre("holy-orb", "orbs", "Holy light", "orb", P.holy, {warp: 0.6, swirl: 0.3, core: 1.2, rim: 0.9, glow: 0.9, sparkle: 0.3}, {description: "Radiant, warm and bright.", token: {light: {radius: 4}}}),
  pre("water-orb", "orbs", "Water sphere", "orb", P.water, {warp: 2, swirl: 0.6, core: 0.3, rim: 1}, {description: "Rolling currents inside a clear sphere."}),
  pre("blood-orb", "orbs", "Blood orb", "orb", P.blood, {warp: 2.2, swirl: 0.4, veins: 0.5, core: 0.3}, {description: "Dark, pulsing, veined."}),
  pre("sun-orb", "orbs", "Miniature sun", "orb", P.sun, {warp: 2.6, swirl: 0.9, core: 1.3, glow: 1, veins: 0.2, pulse: 0.5}, {description: "A blazing star in your hand.", token: {light: {radius: 6, animation: "torch"}}}),
  pre("moon-orb", "orbs", "Moonstone", "orb", P.moon, {warp: 0.5, swirl: 0.05, core: 0.3, rim: 0.8, glow: 0.5, scale: 3}, {description: "Pale and cratered, softly lit."}),
  pre("poison-orb", "orbs", "Poison globe", "orb", P.poison, {warp: 2, swirl: 0.7, veins: 0.25, sparkle: 0.2}, {description: "Bubbling green toxin."}),

  /* Sparks & motes */
  pre("spark", "sparks", "Spark", "spark", P.gold, {}, {description: "A bright four-point twinkle."}),
  pre("star", "sparks", "Star", "spark", P.frost, {shape: 6, glow: 0.8}, {description: "Six rays of cold starlight."}),
  pre("ember", "sparks", "Ember", "mote", P.ember, {glow: 0.8, pulse: 0.8, pulseRate: 2}, {description: "A drifting coal of fire."}),
  pre("firefly", "sparks", "Firefly", "mote", P.poison, {size: 0.25, glow: 0.9, pulse: 1, pulseRate: 0.7}, {description: "A soft green glow that comes and goes."}),
  pre("arcane-mote", "sparks", "Arcane mote", "mote", P.arcane, {glow: 0.8}, {description: "A tiny bead of magic, perfect for missiles."}),
  pre("holy-mote", "sparks", "Blessed mote", "mote", P.holy, {glow: 0.9, core: 1}, {description: "A speck of radiant light."}),
  pre("smoke-puff", "sparks", "Smoke puff", "mote", ["#050507", "#2a2a31", "#5c5c66", "#8e8e99"], {size: 0.6, scale: 2.4, glow: 0.25, core: 0, pulse: 0, swirl: 0.3},
    {description: "A soft, dark puff for smoke and dust."}),
  pre("mist-puff", "sparks", "Mist puff", "mote", P.frost, {size: 0.6, scale: 2.2, glow: 0.45, core: 0.1, pulse: 0, swirl: 0.25},
    {description: "A pale, cold wisp of vapour."}),
  pre("fire-puff", "sparks", "Fire puff", "mote", P.fire, {size: 0.55, scale: 3, glow: 0.8, core: 0.9, pulse: 0.3, pulseRate: 3, swirl: 0.9},
    {description: "A bright billow of flame for blasts and breath."}),

  /* Flames & wisps */
  pre("flame", "flames", "Flame", "flame", P.fire, {}, {description: "A living flame, tip up.", token: {light: {radius: 3, animation: "flame"}}}),
  pre("wisp", "flames", "Will-o'-wisp", "flame", P.ghost, {swirl: 0.5, size: 0.5, glow: 0.8}, {description: "A cold, curious spirit light.", token: {light: {radius: 2, animation: "pulse"}}}),
  pre("soulfire", "flames", "Soulfire", "flame", P.toxic, {swirl: 1.1, core: 0.9}, {description: "Ghostly green fire."}),
  pre("hellfire", "flames", "Hellfire", "flame", P.blood, {swirl: 1.3, scale: 4}, {description: "Dark red infernal flame."}),

  /* Crystals */
  pre("ice-shard", "crystals", "Ice shard", "shard", P.frost, {shape: 6}, {description: "A sharp spike of ice."}),
  pre("amethyst", "crystals", "Amethyst", "shard", P.arcane, {shape: 5, sparkle: 0.8}, {description: "A glittering violet crystal."}),
  pre("emerald", "crystals", "Emerald", "shard", P.nature, {shape: 8}, {description: "A cut green gem."}),
  pre("obsidian", "crystals", "Obsidian blade", "shard", P.shadow, {shape: 4, rim: 1.2, glow: 0.3}, {description: "Black glass, sharp edges."}),

  /* Runes & portals */
  pre("arcane-circle", "runes", "Arcane circle", "rune", P.arcane, {shape: 5}, {description: "A turning pentagram ring."}),
  pre("holy-seal", "runes", "Holy seal", "rune", P.holy, {shape: 6, glow: 0.8}, {description: "A radiant hexagram seal.", token: {light: {radius: 3}}}),
  pre("infernal-circle", "runes", "Infernal circle", "rune", P.blood, {shape: 7, spin: -0.3}, {description: "A blood-red summoning ring."}),
  pre("nature-circle", "runes", "Druid circle", "rune", P.nature, {shape: 8, spin: 0.15}, {description: "An eight-pointed circle of growth."}),
  pre("portal", "runes", "Portal", "vortex", P.arcane, {shape: 3}, {description: "A swirling gateway.", token: {light: {radius: 3, animation: "energy"}}}),
  pre("black-hole", "runes", "Black hole", "vortex", P.void, {shape: 2, spin: 2.5, warp: 1.2, rim: 1.2}, {description: "Everything falls in."}),
  pre("whirlpool", "runes", "Whirlpool", "vortex", P.water, {shape: 4, spin: 1, swirl: 0.8}, {description: "Water spiralling down."}),

  /* Shields */
  pre("force-field", "shields", "Force field", "bubble", P.electric, {veins: 0.8, sparkle: 0.2, rim: 0.9}, {description: "A shimmering hex-cell barrier."}),
  pre("soap-bubble", "shields", "Bubble", "bubble", P.water, {veins: 0, sparkle: 1, rim: 0.6, size: 0.7}, {description: "A rainbow-film bubble."}),
  pre("holy-ward", "shields", "Holy ward", "bubble", P.holy, {veins: 0.5, sparkle: 0.3, rim: 1, glow: 0.7}, {description: "A golden protective dome."}),
  pre("dark-shell", "shields", "Dark shell", "bubble", P.void, {veins: 0.3, sparkle: 0.4, rim: 1.2}, {description: "A violet shell of shadow."}),

  /* Auras */
  pre("fire-aura", "auras", "Fire aura", "aura", P.fire, {swirl: 0.9}, {description: "Flames lick outward from the bearer."}),
  pre("frost-aura", "auras", "Frost aura", "aura", P.frost, {swirl: 0.3, sparkle: 0.8}, {description: "A cold, glittering ring."}),
  pre("holy-aura", "auras", "Holy aura", "aura", P.holy, {swirl: 0.4, rim: 1, glow: 0.6}, {description: "A halo of radiant light."}),
  pre("shadow-aura", "auras", "Shadow aura", "aura", P.shadow, {swirl: 0.5, sparkle: 0}, {description: "Smoky darkness clinging to the bearer."}),
  pre("nature-aura", "auras", "Nature aura", "aura", P.nature, {swirl: 0.4, sparkle: 0.6}, {description: "Living green energy."}),
  pre("storm-aura", "auras", "Storm aura", "aura", P.electric, {swirl: 1.4, scale: 5, rim: 0.8}, {description: "Crackling electric ring."}),
  pre("arcane-aura", "auras", "Arcane aura", "aura", P.arcane, {swirl: 0.6, sparkle: 0.7}, {description: "Violet magic swirling around the bearer."}),
  pre("poison-aura", "auras", "Poison aura", "aura", P.poison, {swirl: 0.35, scale: 2.4}, {description: "A sickly green haze."})
].map(normalizePresetBuiltin);

function normalizePresetBuiltin(p) {
  return normalizePreset(p);
}

export const PALETTE_PRESETS = P;
