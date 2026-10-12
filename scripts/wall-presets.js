// Effect walls: a look painted along a path (any animator animation's drawn shape), revealed all at once, growing
// from start to end, running round like a train, or following a token, optionally backed by real Foundry walls.

import {LINE_STYLES} from "./line-shader.js";
import {PALETTE_PRESETS as P} from "./presets.js";

export const REVEAL_MODES = {
  full: {label: "All at once", icon: "fa-solid fa-square"},
  grow: {label: "Grow from start to end", icon: "fa-solid fa-arrow-right-long"},
  train: {label: "Run along it like a train", icon: "fa-solid fa-train"},
  follow: {label: "Follow a token", icon: "fa-solid fa-person-walking-arrow-right"}
};
export const GROW_THEN = {stay: "Then stay", loop: "Then start over", fade: "Then fade away"};
export const TRAIN_THEN = {loop: "Keep going round", once: "Pass once and vanish", stay: "Stop at the end"};
export const DIRECTIONS = {forward: "From the path's start", backward: "From the path's end"};
export const BLOCKS = {
  none: "Nothing (just an effect)",
  move: "Movement",
  sight: "Sight and light",
  all: "Movement, sight and light"
};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;
const idOrNull = v => (typeof v === "string" && v ? v : null);

export const LOOK_LIMITS = {
  width: {label: "Width (squares)", min: 0.05, max: 6, step: 0.05},
  scale: {label: "Pattern size", min: 0.2, max: 6, step: 0.05},
  speed: {label: "Motion speed", min: -6, max: 6, step: 0.05},
  intensity: {label: "Intensity", min: 0, max: 2, step: 0.05},
  glow: {label: "Glow", min: 0, max: 1.5, step: 0.05},
  alpha: {label: "Opacity", min: 0.05, max: 1, step: 0.05}
};

/** Layers: more lines along a wall's path (a ring beside it, a star across it), up to this many. */
export const MAX_LAYERS = 4;
export const LAYER_KINDS = {
  line: {label: "A line beside it", add: "Add a line", icon: "fa-solid fa-grip-lines"},
  star: {label: "A star across it", add: "Add a star", icon: "fa-solid fa-star"}
};
export const LAYER_LIMITS = {
  offset: {label: "Distance (sq, − inside, + outside)", min: -3, max: 3, step: 0.05},
  points: {label: "Points", min: 3, max: 12, step: 1},
  step: {label: "Join every", min: 1, max: 6, step: 1},
  inset: {label: "Drawn in", min: 0, max: 0.9, step: 0.01},
  turn: {label: "Turn (degrees)", min: -180, max: 180, step: 1}
};

const paletteOf = p => (Array.isArray(p) && (p.length === 4) && p.every(c => HEX.test(c ?? "")) ? p.map(c => c.toLowerCase()) : null);

/**
 * One layer. A "line" runs beside the path (offset squares: − inside a loop, + outside; on an open path − is its left);
 * a "star" joins `points` points round a loop's middle (turned by `turn` degrees), every `step`-th one, drawn in
 * towards the middle by `inset`.
 * Its own palette, or null to use the wall's colours.
 */
export function normalizeLayer(l={}) {
  const kind = l.kind === "star" ? "star" : "line";
  const out = {kind, style: l.style in LINE_STYLES ? l.style : "beam", palette: paletteOf(l.palette),
    seed: Math.abs(Math.round(num(l.seed, 11))) % 100000};
  const defaults = {width: kind === "star" ? 0.15 : 0.18, scale: 1, speed: 1, intensity: 1, glow: 0.8, alpha: 1};
  for ( const [k, f] of Object.entries(LOOK_LIMITS) ) out[k] = clamp(num(l[k], defaults[k]), f.min, f.max);
  if ( kind === "line" ) out.offset = clamp(num(l.offset, -0.5), LAYER_LIMITS.offset.min, LAYER_LIMITS.offset.max);
  else {
    out.points = Math.round(clamp(num(l.points, 6), LAYER_LIMITS.points.min, LAYER_LIMITS.points.max));
    // Joining every k-th point: 1 is the polygon, more makes stars; past half the points the lines repeat
    out.step = Math.round(clamp(num(l.step, out.points >= 5 ? 2 : 1), 1, Math.floor(out.points / 2)));
    out.inset = clamp(num(l.inset, 0.1), LAYER_LIMITS.inset.min, LAYER_LIMITS.inset.max);
    out.turn = clamp(num(l.turn, 0), LAYER_LIMITS.turn.min, LAYER_LIMITS.turn.max);
  }
  return out;
}

/** What a wall looks like. */
export function normalizeLook(l={}) {
  const style = l.style in LINE_STYLES ? l.style : "fire";
  const palette = Array.from({length: 4}, (_, i) => (HEX.test(l.palette?.[i] ?? "") ? l.palette[i].toLowerCase() : P.fire[i]));
  const out = {style, palette, seed: Math.abs(Math.round(num(l.seed, 7))) % 100000};
  const defaults = {width: 0.8, scale: 1, speed: 1, intensity: 1, glow: 0.7, alpha: 1};
  for ( const [k, f] of Object.entries(LOOK_LIMITS) ) out[k] = clamp(num(l[k], defaults[k]), f.min, f.max);
  // A layer's "own colours" switch: on, it starts from the wall's colours; off, it goes back to them
  out.layers = (Array.isArray(l.layers) ? l.layers : []).filter(x => x && (typeof x === "object")).slice(0, MAX_LAYERS).map(x => {
    const layer = normalizeLayer(x);
    if ( x.ownColours === true ) layer.palette ??= [...palette];
    else if ( x.ownColours === false ) layer.palette = null;
    return layer;
  });
  return out;
}

/** How a wall appears over time. */
export function normalizeReveal(r={}) {
  const mode = r.mode in REVEAL_MODES ? r.mode : "full";
  const thenChoices = mode === "train" ? TRAIN_THEN : GROW_THEN;
  return {
    mode,
    direction: r.direction in DIRECTIONS ? r.direction : "forward",
    duration: clamp(num(r.duration, 4), 0.1, 600),
    then: r.then in thenChoices ? r.then : Object.keys(thenChoices)[0],
    hold: clamp(num(r.hold, 2), 0, 600),
    fade: clamp(num(r.fade, 2), 0.1, 600),
    length: clamp(num(r.length, mode === "follow" ? 3 : 4), 0, 200),
    speed: clamp(num(r.speed, 3), 0.05, 60),
    token: idOrNull(r.token),
    start: Number.isFinite(Number(r.start)) && (r.start !== null) ? Number(r.start) : null
  };
}

/** A wall preset (library item). */
export function normalizeWallPreset(p={}) {
  return {
    id: idOrNull(p.id),
    name: String(p.name ?? "Effect wall"),
    description: String(p.description ?? ""),
    category: typeof p.category === "string" ? p.category : "mine",
    builtin: !!p.builtin,
    look: normalizeLook(p.look),
    reveal: normalizeReveal(p.reveal),
    blocks: p.blocks in BLOCKS ? p.blocks : "none",
    emitter: idOrNull(p.emitter),
    emitterRate: clamp(num(p.emitterRate, 20), 0, 200),
    below: p.below !== false
  };
}

/** A wall on a scene. */
export function normalizeWall(w={}) {
  const {category, builtin, ...base} = normalizeWallPreset(w);
  return {
    ...base,
    preset: idOrNull(w.preset),
    source: {animId: idOrNull(w.source?.animId)},
    // v14 scene levels: the level it is on (null: every level)
    level: idOrNull(w.level),
    elevation: num(w.elevation, 0),
    hidden: !!w.hidden
  };
}

/** Does a wall stand complete right now (so real walls make sense)? */
export function standsComplete(wall, elapsed) {
  const r = wall.reveal;
  if ( r.mode === "full" ) return true;
  if ( r.mode === "grow" ) return (r.then === "stay") && (elapsed >= r.duration);
  return false;
}

const wp = (id, name, description, look, extra={}) => normalizeWallPreset({id: `builtin-${id}`, builtin: true, category: "walls", name,
  description, look, ...extra});

export const BUILTIN_WALLS = [
  wp("wall-of-fire", "Wall of fire", "A roaring line of flame with embers drifting up.",
    {style: "fire", palette: P.fire, width: 0.8, speed: 1}, {emitter: "builtin-embers", emitterRate: 25}),
  wp("sealing-chains", "Sealing chains", "Glowing golden chains sliding along the seal — a sealed room, a bound demon.",
    {style: "chains", palette: P.holy, width: 0.55, speed: 0.6, glow: 1}, {blocks: "move"}),
  wp("spectral-chains", "Spectral chains", "Ghostly chains drifting the other way.",
    {style: "chains", palette: P.ghost, width: 0.5, speed: -0.4, glow: 1.1, alpha: 0.9}),
  wp("iron-chains", "Iron chains", "Heavy dark chains, barely moving.",
    {style: "chains", palette: P.moon, width: 0.5, speed: 0.15, glow: 0.15}, {blocks: "move"}),
  wp("lightning-fence", "Lightning fence", "Crackling bolts that re-strike constantly.",
    {style: "lightning", palette: P.electric, width: 0.7, speed: 1}),
  wp("wall-of-ice", "Wall of ice", "Jagged glittering ice.",
    {style: "frost", palette: P.frost, width: 0.7, speed: 0.6}, {blocks: "all"}),
  wp("thorn-hedge", "Thorn hedge", "Twisting vines full of thorns.",
    {style: "thorns", palette: P.nature, width: 0.7, speed: 0.5}, {blocks: "move"}),
  wp("rune-ward", "Rune ward", "A band of turning arcane glyphs.",
    {style: "runes", palette: P.arcane, width: 0.6, speed: 0.6}),
  wp("holy-ward", "Holy ward", "Radiant glyphs between two lines of light.",
    {style: "runes", palette: P.holy, width: 0.6, speed: 0.4, glow: 0.9}),
  // Seals: a band of glyphs with rings of light beside it and a star across it, like the rune circles, along any path
  wp("holy-seal", "Holy seal", "A radiant hexagram seal: glyphs between rings of light round a six-pointed star. Draw it round a room to seal it.",
    {style: "runes", palette: P.holy, width: 0.45, speed: 0.35, glow: 0.9, layers: [
      {kind: "line", style: "beam", width: 0.12, offset: -0.42, glow: 1},
      {kind: "line", style: "beam", width: 0.1, offset: 0.3, glow: 0.9},
      {kind: "star", style: "beam", width: 0.14, points: 6, step: 2, inset: 0.14, glow: 1}
    ]}),
  wp("arcane-seal", "Arcane seal", "A turning pentagram inside a ring of arcane glyphs.",
    {style: "runes", palette: P.arcane, width: 0.45, speed: 0.5, glow: 0.8, layers: [
      {kind: "line", style: "beam", width: 0.12, offset: -0.42},
      {kind: "star", style: "beam", width: 0.14, points: 5, step: 2, inset: 0.14}
    ]}),
  wp("infernal-seal", "Infernal seal", "A blood-red heptagram summoning circle.",
    {style: "runes", palette: P.blood, width: 0.5, speed: -0.3, glow: 0.8, layers: [
      {kind: "line", style: "fire", width: 0.22, offset: -0.5, speed: 0.8, palette: P.ember},
      {kind: "line", style: "beam", width: 0.1, offset: 0.34},
      {kind: "star", style: "beam", width: 0.14, points: 7, step: 3, inset: 0.16}
    ]}),
  wp("druid-circle", "Druid circle", "An eight-pointed star of living light in a ring of thorny vines.",
    {style: "thorns", palette: P.nature, width: 0.5, speed: 0.3, layers: [
      {kind: "line", style: "runes", width: 0.3, offset: -0.5, speed: 0.4},
      {kind: "star", style: "beam", width: 0.12, points: 8, step: 3, inset: 0.16}
    ]}),
  wp("wall-of-force", "Wall of force", "A shimmering, nearly invisible barrier.",
    {style: "force", palette: P.electric, width: 0.45, speed: 0.6}, {blocks: "move"}),
  wp("wall-of-shadow", "Wall of shadow", "Writhing darkness nobody can see through.",
    {style: "shadow", palette: P.shadow, width: 1, speed: 0.5}, {blocks: "sight"}),
  wp("toxic-fumes", "Toxic fumes", "A creeping line of poisonous smog.",
    {style: "shadow", palette: P.poison, width: 1.1, speed: 0.4, alpha: 0.85}),
  wp("river", "River", "Flowing water with foaming banks.",
    {style: "water", palette: P.water, width: 1.2, speed: 0.8}),
  wp("laser", "Laser", "A thin searing beam.",
    {style: "beam", palette: ["#3d0000", "#ff1a1a", "#ff8080", "#ffffff"], width: 0.25, speed: 1}),
  wp("fire-trail", "Fire trail", "Flames left burning behind a moving token for a few squares.",
    {style: "fire", palette: P.fire, width: 0.45, speed: 1.2}, {reveal: {mode: "follow", length: 4}}),
  wp("fuse", "Burning fuse", "Fire running along the path from start to end, then staying lit.",
    {style: "fire", palette: P.ember, width: 0.35, speed: 1.4}, {reveal: {mode: "grow", duration: 6, then: "stay"}})
];
