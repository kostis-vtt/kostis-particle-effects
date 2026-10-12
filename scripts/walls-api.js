// Effect walls: create, change and remove them (every change can be undone). Scene flags hold the walls; the path
// each one follows is an animator animation.

import {ANIMATOR_ID, DEL, FLAG_WALLS, MODULE_ID} from "./const.js";
import {normalizeWall} from "./wall-presets.js";
import {sceneWalls} from "./effect-walls.js";
import {Library} from "./library.js";
import {REPLACE, remember} from "./undo.js";

// Walls follow animator paths (Kostis's Actual Animator 1.3+ draws and provides them)
const kaa = () => {
  const api = game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null;
  return (typeof api?.track === "function") && (typeof api.draw === "function") ? api : null;
};
const L = (key, data) => (data ? game.i18n.format(`KPE.Undo.${key}`, data) : game.i18n.localize(`KPE.Undo.${key}`));
const sceneOf = scene => (typeof scene === "string" ? game.scenes.get(scene) : (scene ?? canvas.scene));

function raw(scene, id) {
  const w = scene?.getFlag(MODULE_ID, FLAG_WALLS)?.[id];
  return w ? foundry.utils.deepClone(w) : null;
}

/** The level new walls go on: the viewed one, on a scene that has more than one. */
function levelFor(scene) {
  if ( !((scene?.levels?.size ?? 0) > 1) ) return null;
  return scene === canvas.scene ? (canvas.level?.id ?? null) : (scene.initialLevel?.id ?? null);
}

function write(scene, entries) {
  return scene.update({flags: {[MODULE_ID]: {[FLAG_WALLS]: entries}}});
}

export const Walls = {
  /** Every effect wall on a scene. */
  list: scene => sceneWalls(sceneOf(scene)),

  get: (id, scene) => sceneWalls(sceneOf(scene)).find(w => w.id === id) ?? null,

  /**
   * Make an effect wall.
   * @param {object} data      {preset (id, name or a preset object), source: {animId}, name, look, reveal, blocks, emitter,
   *                            emitterRate, below, elevation}
   * @param {object} [options]
   * @param {boolean} [options.record=true]   Record an undo step
   */
  async create(data, {scene, record=true}={}) {
    scene = sceneOf(scene);
    const preset = data.preset ? Library.get("walls", data.preset) : null;
    const base = preset ? {name: preset.name, look: preset.look, reveal: preset.reveal, blocks: preset.blocks, emitter: preset.emitter,
      emitterRate: preset.emitterRate, below: preset.below} : {};
    // On a scene with several levels a new wall belongs to the level being viewed (like Foundry's own placeables)
    const level = data.level !== undefined ? data.level : levelFor(scene);
    const wall = normalizeWall({
      ...base, ...data, level,
      look: {...(base.look ?? {}), ...(data.look ?? {})},
      reveal: {...(base.reveal ?? {}), ...(data.reveal ?? {}), start: game.time.serverTime},
      preset: preset?.id ?? null
    });
    wall.id = foundry.utils.randomID(10);
    await write(scene, {[wall.id]: wall});
    if ( record ) remember(L("CreateWall", {name: wall.name}), () => write(scene, {[wall.id]: DEL()}), scene);
    return wall;
  },

  /**
   * Change a wall. `look` and `reveal` are merged; changing how it appears restarts it.
   * @param {string} id
   * @param {object} changes
   */
  async update(id, changes, {scene, label}={}) {
    scene = sceneOf(scene);
    const cur = raw(scene, id);
    if ( !cur ) return null;
    const curN = normalizeWall(cur);
    const reveal = {...curN.reveal, ...(changes.reveal ?? {})};
    const restart = changes.reveal && ["mode", "direction", "duration", "then"].some(k => (k in changes.reveal) && (changes.reveal[k] !== curN.reveal[k]));
    if ( restart && !("start" in changes.reveal) ) reveal.start = game.time.serverTime;
    const next = normalizeWall({...curN, ...changes, look: {...curN.look, ...(changes.look ?? {})}, reveal, source: changes.source ?? curN.source,
      level: "level" in changes ? changes.level : curN.level});
    next.id = id;
    await write(scene, {[id]: REPLACE(next)});
    remember(label ?? L("ChangeWall", {name: next.name}), () => write(scene, {[id]: REPLACE(cur)}), scene);
    return next;
  },

  /** Start a wall's reveal over (grow, train). */
  restart(id, {scene}={}) {
    return this.update(id, {reveal: {start: game.time.serverTime}}, {scene, label: L("RestartWall")});
  },

  /**
   * Remove a wall (and, optionally, the animator path it follows).
   * @param {string} id
   * @param {object} [options]
   * @param {boolean} [options.withPath=false]
   */
  async remove(id, {scene, withPath=false}={}) {
    scene = sceneOf(scene);
    const cur = raw(scene, id);
    if ( !cur ) return false;
    const api = kaa();
    const animId = cur.source?.animId;
    const anim = withPath && api && animId ? foundry.utils.deepClone(api.getAnimation(animId, scene)) : null;
    await write(scene, {[id]: DEL()});
    if ( anim ) await api.deleteAnimation(animId, {scene});
    remember(L("RemoveWall", {name: cur.name ?? ""}), async () => {
      if ( anim && !api.getAnimation(animId, scene) ) await api.createAnimation(anim, {scene});
      await write(scene, {[id]: cur});
    }, scene);
    return true;
  },

  /**
   * Draw a new path for a wall with an animator tool; the wall shows as soon as the path does.
   * @param {string|object} presetRef
   * @param {object} [options]
   * @param {string} [options.tool="pen"]   pen, freehand, rect, ellipse, polygon, figure8, spiral, wave
   */
  async draw(presetRef, {tool="pen", scene}={}) {
    scene = sceneOf(scene);
    const api = kaa();
    if ( !api ) {
      ui.notifications.warn("KPE.Warn.WallsNeedAnimator", {localize: true});
      return null;
    }
    const preset = Library.get("walls", presetRef) ?? Library.get("walls", "builtin-wall-of-fire");
    const anim = await api.createAnimation({name: preset.name, color: preset.look.palette[2], tokens: [], steps: []}, {scene});
    if ( !anim ) return null;
    const wall = await this.create({preset, source: {animId: anim.id}}, {scene, record: false});
    remember(L("CreateWall", {name: wall.name}), async () => {
      await write(scene, {[wall.id]: DEL()});
      if ( api.getAnimation(anim.id, scene) ) await api.deleteAnimation(anim.id, {scene});
    }, scene);
    api.draw(anim.id, tool);
    ui.notifications.info("KPE.Info.DrawWall", {localize: true});
    return wall;
  },

  /** Put an effect along an existing animator path (the infinity sign of an animation, a drawn room…). */
  attach(presetRef, animId, {scene}={}) {
    const preset = Library.get("walls", presetRef) ?? Library.get("walls", "builtin-wall-of-fire");
    return this.create({preset, source: {animId}}, {scene});
  }
};
