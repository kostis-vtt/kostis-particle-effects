// Seals: a rune circle turned into an effect wall in the same look, along a path you can reshape and stretch over a
// whole room. Its glyph band, the rings either side of it and the star inside become the wall's line and layers.

import {ANIMATOR_ID, DEL, FLAG_PARTICLE, FLAG_WALLS, MODULE_ID} from "./const.js";
import {normalizePreset} from "./presets.js";
import {Walls} from "./walls-api.js";
import {copies, recreate, remember, removeTokens} from "./undo.js";

const kaa = () => {
  const api = game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null;
  return (typeof api?.createAnimation === "function") && (typeof api.draw === "function") ? api : null;
};

/** The middle of a rune circle's glyph band, as a share of its image's radius (see rune() in the shader). */
const BAND = 0.93;

/**
 * A wall look from a rune circle's look.
 * @param {object} preset    A normalized particle preset
 * @param {number} radius    The seal's radius in squares (the middle of its glyph band)
 */
export function sealLook(preset, radius) {
  const L = preset.look;
  const width = Math.min(1.2, Math.max(0.25, radius * 0.22));
  const sides = Math.max(3, Math.round(L.shape));
  return {
    style: "runes", palette: [...preset.palette], seed: preset.seed, width,
    speed: Math.max(-6, Math.min(6, L.spin * 1.5)), glow: Math.min(1.5, L.glow + 0.3), alpha: L.alpha,
    layers: [
      {kind: "line", style: "beam", width: width * 0.28, offset: -width * 0.9, glow: 1},
      {kind: "line", style: "beam", width: width * 0.22, offset: width * 0.7, glow: 0.9},
      // The circle's star: every second point from five up, like the particle
      {kind: "star", style: "beam", width: width * 0.3, points: sides, step: sides >= 5 ? 2 : 1, inset: 0.12}
    ]
  };
}

/**
 * Where a seal's path goes on the map: the particle's outline (or a circle of eight round points, from the top) at its
 * glyph band, turned and mirrored like its image.
 * @param {TokenDocument} doc
 * @param {object} preset    A normalized particle preset
 * @returns {{x: number, y: number, smooth: number}[]}
 */
export function sealNodes(doc, preset) {
  const grid = doc.parent?.dimensions?.size ?? 100;
  const c = doc.object?.center ?? {x: doc.x + ((doc.width * grid) / 2), y: doc.y + ((doc.height * grid) / 2)};
  const R = ((Math.min(doc.width, doc.height) * grid) / 2) * preset.look.size * BAND;
  const angle = doc.lockRotation ? 0 : (((doc.rotation ?? 0) * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sx = doc.texture?.scaleX || 1;
  const sy = doc.texture?.scaleY || 1;
  const src = preset.outline?.nodes ?? Array.from({length: 8}, (_, i) => {
    const a = (-Math.PI / 2) + ((Math.PI * i) / 4);
    return {x: Math.cos(a), y: Math.sin(a), smooth: 1};
  });
  return src.map(n => {
    const x = n.x * R * sx;
    const y = n.y * R * sy;
    return {x: c.x + (x * cos) - (y * sin), y: c.y + (x * sin) + (y * cos), smooth: n.smooth};
  });
}

/**
 * Turn a rune circle into a seal on the same spot: an effect wall along a path (made with the animator) whose points
 * are dragged with the animator's edit tool. The particle goes away; one Ctrl+Z brings it back.
 * @param {TokenDocument} doc
 * @param {object} [options]
 * @param {object} [options.preset]   The look to use (an unsaved edit), else the particle's own
 * @returns {Promise<object|null>}   The new wall
 */
export async function particleToSeal(doc, {preset}={}) {
  const api = kaa();
  if ( !api ) {
    ui.notifications.warn("KPE.Warn.WallsNeedAnimator", {localize: true});
    return null;
  }
  const data = doc?.getFlag(MODULE_ID, FLAG_PARTICLE);
  if ( !data?.preset ) return null;
  preset = normalizePreset(preset ?? data.preset);
  const scene = doc.parent;
  const radius = (Math.min(doc.width, doc.height) / 2) * preset.look.size * BAND;
  const name = preset.name;
  const nodes = sealNodes(doc, preset);
  const anim = await api.createAnimation({name: `${name} (seal)`, color: preset.palette[2], tokens: [],
    steps: [{shape: {type: "path", closed: true, nodes}}]}, {scene});
  if ( !anim ) return null;
  const wall = await Walls.create({name, look: sealLook(preset, radius), source: {animId: anim.id}, elevation: doc.elevation ?? 0},
    {scene, record: false});
  const before = copies([doc]);
  await removeTokens(scene, [doc.id]);
  remember(game.i18n.format("KPE.Undo.Seal", {name}), async () => {
    await scene.update({flags: {[MODULE_ID]: {[FLAG_WALLS]: {[wall.id]: DEL()}}}});
    if ( api.getAnimation(anim.id, scene) ) await api.deleteAnimation(anim.id, {scene});
    await recreate(scene, before);
  }, scene);
  // Straight to reshaping it
  if ( scene === canvas.scene ) {
    api.draw(anim.id, "edit");
    ui.notifications.info("KPE.Info.Sealed", {localize: true});
  }
  return wall;
}
