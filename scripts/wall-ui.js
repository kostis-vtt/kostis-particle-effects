// What the wall editor needs (shared by the studio's Walls tab and the Effect Walls manager).

import {LINE_STYLES} from "./line-shader.js";
import {BLOCKS, DIRECTIONS, GROW_THEN, LAYER_KINDS, LAYER_LIMITS, LOOK_LIMITS, MAX_LAYERS, REVEAL_MODES, TRAIN_THEN} from "./wall-presets.js";
import {PALETTE_PRESETS} from "./presets.js";
import {Library} from "./library.js";

const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step >= 0.1 ? 1 : 2));
const options = (record, value) => Object.entries(record).map(([k, v]) => ({value: k, label: v.label ?? v, selected: k === value}));

/** The editor of one layer (its fields are named look.layers.<i>.<key>). */
function layerContext(layer, i, look) {
  const keys = [...(layer.kind === "star" ? ["points", "step", "inset", "turn"] : ["offset"]), "width", "scale", "speed", "glow", "alpha"];
  return {
    i, kind: layer.kind, title: LAYER_KINDS[layer.kind].label, icon: LAYER_KINDS[layer.kind].icon,
    styles: options(LINE_STYLES, layer.style),
    own: !!layer.palette,
    palette: (layer.palette ?? look.palette).map((value, j) => ({j, value})),
    sliders: keys.map(k => {
      const f = LAYER_LIMITS[k] ?? LOOK_LIMITS[k];
      // Past half the points, joining every k-th point repeats a star the other way round
      const max = k === "step" ? Math.floor(layer.points / 2) : f.max;
      return {key: `look.layers.${i}.${k}`, label: f.label, min: f.min, max, step: f.step, value: layer[k], text: fmt(layer[k], f.step)};
    })
  };
}

/**
 * @param {object} item     A normalized wall or wall preset
 * @param {object} [extra]
 * @param {object[]} [extra.tokens]   Tokens a "follow" reveal can follow ({id, name})
 */
export function wallEditorContext(item, {tokens=[]}={}) {
  const r = item.reveal;
  return {
    styles: options(LINE_STYLES, item.look.style),
    palette: item.look.palette.map((c, i) => ({i, value: c})),
    palettes: Object.entries(PALETTE_PRESETS).map(([key, colors]) => ({key, gradient: `linear-gradient(90deg, ${colors.join(", ")})`})),
    sliders: Object.entries(LOOK_LIMITS).map(([k, f]) => ({key: `look.${k}`, label: f.label, min: f.min, max: f.max, step: f.step,
      value: item.look[k], text: fmt(item.look[k], f.step)})),
    layers: (item.look.layers ?? []).map((l, i) => layerContext(l, i, item.look)),
    canAddLayer: (item.look.layers ?? []).length < MAX_LAYERS,
    layerKinds: Object.entries(LAYER_KINDS).map(([value, k]) => ({value, label: k.add, icon: k.icon})),
    modes: options(REVEAL_MODES, r.mode),
    directions: options(DIRECTIONS, r.direction),
    thens: options(r.mode === "train" ? TRAIN_THEN : GROW_THEN, r.then),
    isGrow: r.mode === "grow",
    isTrain: r.mode === "train",
    isFollow: r.mode === "follow",
    timed: (r.mode === "grow") || (r.mode === "train"),
    reveal: r,
    tokens: [{value: "", label: "Choose a token…", selected: !r.token},
      ...tokens.map(t => ({value: t.id, label: t.name, selected: t.id === r.token}))],
    blocks: options(BLOCKS, item.blocks),
    blocksNote: (item.blocks !== "none") && !["full", "grow"].includes(r.mode),
    emitters: [{value: "", label: "None", selected: !item.emitter},
      ...Library.all("emitters").filter(e => !e.oneShot).map(e => ({value: e.id, label: `${e.name}${e.builtin ? "" : " ★"}`, selected: e.id === item.emitter}))],
    emitterRate: item.emitterRate,
    below: item.below
  };
}
