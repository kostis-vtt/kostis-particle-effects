// Effect walls on the map. Every client draws them (from the scene's flags and the animator path they follow);
// the active GM keeps real Foundry walls in step with the ones that block movement or sight, on every scene.

import {ANIMATOR_ID, FLAG_WALLS, HUB_ID, MODULE_ID, NO_HISTORY} from "./const.js";
import {normalizeWall, standsComplete} from "./wall-presets.js";
import {measureTrack, projectOnTrack, revealWindow, trackPoint, wallSegments} from "./wall-geometry.js";
import {layersKey, partMeshes, setPartLooks, tickWallParts, updateWallParts, wallParts} from "./wall-render.js";
import {lineTime} from "./line-shader.js";
import {normalizeEmitter} from "./emitter-presets.js";
import {emitterParticle, generatorConfig, startGenerator} from "./emitters.js";
import {emitterTextures} from "./textures.js";
import {Library} from "./library.js";

// Walls follow animator paths (Kostis's Actual Animator 1.3+ provides them as tracks)
const kaa = () => {
  const api = game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null;
  return typeof api?.track === "function" ? api : null;
};
const TOKENS_LAYER = 700;

/** The walls of a scene, normalized, in a stable order. */
export function sceneWalls(scene=canvas.scene) {
  const raw = scene?.getFlag(MODULE_ID, FLAG_WALLS) ?? {};
  return Object.entries(raw).filter(([, w]) => w).map(([id, w]) => ({...normalizeWall(w), id}))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Seconds since a wall's reveal started (a wall that never started counts as long done). */
export function elapsedOf(wall) {
  const start = wall.reveal.start;
  return start === null ? 1e9 : Math.max(0, (game.time.serverTime - start) / 1000);
}

/** The measured track a wall follows, or null when its path is missing. */
export function trackOf(wall, scene=canvas.scene) {
  const api = kaa();
  if ( !api || !wall.source.animId ) return null;
  const anim = api.getAnimation(wall.source.animId, scene);
  if ( !anim ) return null;
  const track = measureTrack(api.track(anim, {scene}));
  return track.length > 0 ? {track, sig: trackSignature(track)} : null;
}

/** A short fingerprint of a track's shape (meshes are only rebuilt when the shape itself changes). */
function trackSignature(track) {
  let h = 2166136261;
  for ( const pc of track.pieces ) {
    for ( let i = 0; i < pc.points.length; i++ ) h = Math.imul(h ^ Math.round(pc.points[i] * 10), 16777619);
    h = Math.imul(h ^ (pc.closed ? 1 : 2), 16777619);
  }
  return `${track.pieces.length}:${Math.round(track.length)}:${(h >>> 0).toString(36)}`;
}

/**
 * Is a wall on the level being viewed (v14 scene levels)? Like tokens: its own level, or one the viewed level can see.
 * Walls without a level show on every level.
 */
export function onViewedLevel(def) {
  const level = canvas.level;
  if ( !def.level || !level ) return true;
  return (def.level === level.id) || !!level.visibility?.levels?.has?.(def.level);
}

export class EffectWalls {
  /** id → {def, key, track, container, meshes, gen, budget, look, offset} */
  static #entries = new Map();

  /** Unsaved edits shown on this client only (id → partial wall). */
  static #overrides = new Map();

  static #running = false;

  static get size() {
    return this.#entries.size;
  }

  /** The wall as drawn here (with any unsaved edits). */
  static #effective(def) {
    const o = this.#overrides.get(def.id);
    if ( !o ) return def;
    return normalizeWall({...def, ...o, look: {...def.look, ...(o.look ?? {})}, reveal: {...def.reveal, ...(o.reveal ?? {})},
      source: def.source, level: def.level, id: def.id});
  }

  /** Show unsaved edits of a wall on this client (null to stop). */
  static preview(id, partial) {
    if ( !id ) return;
    if ( partial ) this.#overrides.set(id, partial);
    else this.#overrides.delete(id);
    this.sync();
  }

  /** Bring the drawn walls in line with the scene. */
  static sync() {
    if ( !canvas?.ready ) return this.clear();
    const scene = canvas.scene;
    const defs = sceneWalls(scene).map(d => this.#effective(d));
    const grid = scene.dimensions.size;
    const wanted = new Set();
    for ( const def of defs ) {
      if ( def.hidden && !game.user.isGM ) continue;
      if ( !onViewedLevel(def) ) continue;
      const geo = trackOf(def, scene);
      if ( !geo ) continue;
      wanted.add(def.id);
      const look = {...def.look, widthPx: def.look.width * grid};
      // The meshes are rebuilt only when the shape changes: the path, the width or the layers
      const key = `${def.source.animId}:${geo.sig}:${look.widthPx}:${layersKey(look)}`;
      let e = this.#entries.get(def.id);
      if ( !e || (e.key !== key) ) {
        if ( e ) this.#destroy(e);
        const container = new foundry.canvas.primary.PrimaryCanvasParticleContainer();
        const parts = wallParts(geo.track, look, grid);
        for ( const m of partMeshes(parts) ) container.addChild(m);
        canvas.primary.addChild(container);
        e = {key, track: geo.track, container, parts, gen: null, genKey: null, budget: 0, offset: {x: 0, y: 0}};
        this.#entries.set(def.id, e);
      }
      e.def = def;
      e.look = look;
      setPartLooks(e.parts, look, grid);
      e.container.elevation = def.elevation;
      e.container.sortLayer = def.below ? TOKENS_LAYER - 10 : TOKENS_LAYER + 10;
      const win = this.#safeWindow(e);
      updateWallParts(e.parts, win, lineTime());
      this.#syncEmitter(e);
    }
    for ( const [id, e] of [...this.#entries] ) {
      if ( !wanted.has(id) ) {
        this.#destroy(e);
        this.#entries.delete(id);
      }
    }
    if ( this.#entries.size ) this.#start();
    else this.#stop();
  }

  /** The visible part of a wall right now (also where it is: a wall following a token runs where the token runs). */
  static #window(e) {
    const def = e.def;
    let head = null;
    let cycles = null;
    e.offset = {x: 0, y: 0};
    if ( def.reveal.mode === "follow" ) {
      const doc = canvas.scene.tokens.get(def.reveal.token);
      const c = doc?.object?.center;
      // A token hidden by the GM leaves no trail for players
      if ( c && !(doc.hidden && !game.user.isGM) ) {
        const api = kaa();
        // A relative animation runs where the token began: the trail is drawn there, behind the token
        const off = api?.trackOffset?.(def.source.animId, doc) ?? {x: 0, y: 0};
        e.offset = {x: off.x || 0, y: off.y || 0};
        head = projectOnTrack(e.track, {x: c.x - e.offset.x, y: c.y - e.offset.y})?.u ?? null;
        cycles = api?.status(doc)?.cycles ?? 0;
      }
    }
    return revealWindow(def.reveal, {length: e.track.length, closed: e.track.closed, grid: canvas.dimensions.size,
      elapsed: elapsedOf(def), head, cycles});
  }

  /** The window, or nothing shown when it can't be worked out (never let one wall break the canvas). */
  static #safeWindow(e) {
    try {
      return this.#window(e);
    } catch(err) {
      console.error(`${MODULE_ID} | effect wall "${e.def?.name}"`, err);
      return {a: 0, span: 0, alpha: 0, taper: 0, front: 0};
    }
  }

  /** Particles drifting off the revealed part of the wall (embers, sparks…). */
  static #syncEmitter(e) {
    const def = e.def;
    const key = def.emitter && (game.settings.get(MODULE_ID, "emitters") !== false)
      ? JSON.stringify([def.emitter, def.look.palette, def.elevation, def.below]) : null;
    if ( key === e.genKey ) return;
    if ( e.gen ) e.gen.stop({hard: true});
    e.gen = null;
    e.genKey = key;
    if ( !key ) return;
    const emitter = Library.get("emitters", def.emitter);
    if ( !emitter ) return;
    const source = {kind: "mote", palette: def.look.palette, look: {glow: 0.8, core: 0.8}};
    const textures = emitterTextures(emitterParticle(emitter, source));
    const cfg = generatorConfig({...normalizeEmitter(emitter), rate: 0, area: "point"},
      {anchor: null, grid: canvas.dimensions.size, textures, elevation: def.elevation});
    try {
      // Embers rise just above the wall itself
      e.gen = startGenerator(new foundry.canvas.animation.ParticleGenerator(cfg), e.container.sortLayer + 1);
    } catch(err) {
      console.error(`${MODULE_ID} | wall emitter`, err);
    }
  }

  static #spawn(e, win, dt) {
    const def = e.def;
    if ( !e.gen || !def.emitterRate || !(win.span > 0) || !(win.alpha > 0) || !e.container.visible ) return;
    // Only the part of the window that is on the path (open paths end; loops wrap)
    let a = win.a;
    let span = win.span;
    if ( !e.track.closed ) {
      const lo = Math.max(0, a);
      const hi = Math.min(e.track.length, a + span);
      a = lo;
      span = hi - lo;
      if ( !(span > 0) ) return;
    }
    e.budget += def.emitterRate * (span / Math.max(1, canvas.dimensions.size * 4)) * dt;
    let n = Math.min(20, Math.floor(e.budget));
    e.budget -= n;
    const half = e.look.widthPx * 0.4;
    while ( n-- > 0 ) {
      const p = trackPoint(e.track, a + (Math.random() * span));
      if ( !p ) break;
      const off = (Math.random() * 2 - 1) * half;
      e.gen.spawnParticle({position: {x: p.x - (Math.sin(p.angle) * off) + e.offset.x, y: p.y + (Math.cos(p.angle) * off) + e.offset.y}});
    }
  }

  static #destroy(e) {
    e.gen?.stop({hard: true});
    e.container.destroy({children: true});
  }

  static #last = 0;

  static #tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.#last || now)) / 1000);
    this.#last = now;
    const t = lineTime();
    for ( const e of this.#entries.values() ) {
      // An error here would stop the whole canvas from drawing (PIXI only asks for the next frame afterwards)
      try {
        const win = this.#window(e);
        const ghost = e.def.hidden ? 0.45 : 1;
        e.container.visible = win.alpha > 0;
        e.container.position.set(e.offset.x, e.offset.y);
        tickWallParts(e.parts, win, t, ghost);
        this.#spawn(e, win, dt);
      } catch(err) {
        e.container.visible = false;
        if ( !e.failed ) console.error(`${MODULE_ID} | effect wall "${e.def?.name}"`, err);
        e.failed = true;
      }
    }
  }

  static #start() {
    if ( this.#running ) return;
    this.#running = true;
    this.#last = 0;
    canvas.app.ticker.add(this.#tick, this);
  }

  static #stop() {
    if ( !this.#running ) return;
    canvas.app?.ticker?.remove(this.#tick, this);
    this.#running = false;
  }

  static clear() {
    this.#stop();
    for ( const e of this.#entries.values() ) this.#destroy(e);
    this.#entries.clear();
  }

  /** Where a wall currently shows (for the manager). */
  static windowOf(id) {
    const e = this.#entries.get(id);
    return e ? {...this.#safeWindow(e), length: e.track.length, closed: e.track.closed} : null;
  }
}

/* -------------------------------------------- */
/*  Real walls (active GM only)                 */
/* -------------------------------------------- */

const SENSE = () => CONST.EDGE_SENSE_TYPES ?? {NONE: 0, NORMAL: 20};

/**
 * Wall data for a blocking mode. The flag names the effect wall and the animator path it follows (other modules read
 * `animId`: Auto-Patrol lets a patrol walk through walls painted along its own route).
 */
function wallData(c, def, sig) {
  const S = SENSE();
  const on = S.NORMAL;
  const off = S.NONE;
  const move = (def.blocks === "move") || (def.blocks === "all");
  const sight = (def.blocks === "sight") || (def.blocks === "all");
  return {
    c, move: move ? (CONST.WALL_MOVEMENT_TYPES?.NORMAL ?? on) : (CONST.WALL_MOVEMENT_TYPES?.NONE ?? off),
    sight: sight ? on : off, light: sight ? on : off, sound: off,
    // On a scene with levels, only on the effect wall's own level (no levels = every level)
    ...(def.level ? {levels: [def.level]} : {}),
    flags: {[MODULE_ID]: {effectWall: {id: def.id, sig, animId: def.source.animId ?? null}}}
  };
}

export class EffectWallBlocks {
  static #timer = null;

  /** Scenes being synced, and scenes asked for again meanwhile. */
  static #busy = new Set();

  static #again = new Set();

  /** Keep a scene's real walls in step with its blocking effect walls (any scene, not only the one being viewed). */
  static async sync(scene=canvas.scene) {
    if ( !scene?.walls || !game.users.activeGM?.isSelf ) return;
    if ( this.#busy.has(scene.id) ) {
      this.#again.add(scene.id);
      return;
    }
    this.#busy.add(scene.id);
    try {
      const api = kaa();
      const grid = scene.dimensions.size;
      const hash = game.modules.get(HUB_ID)?.api?.math?.hashId ?? (v => JSON.stringify(v));
      const existing = scene.walls.filter(w => w.getFlag(MODULE_ID, "effectWall"));
      const byWall = new Map();
      for ( const w of existing ) {
        const id = w.getFlag(MODULE_ID, "effectWall").id;
        byWall.set(id, [...(byWall.get(id) ?? []), w]);
      }
      const remove = [];
      const create = [];
      for ( const def of sceneWalls(scene) ) {
        const mine = byWall.get(def.id) ?? [];
        byWall.delete(def.id);
        const want = api && (def.blocks !== "none") && !def.hidden && standsComplete(def, elapsedOf(def));
        const geo = want ? trackOf(def, scene) : null;
        if ( !geo ) {
          remove.push(...mine.map(w => w.id));
          continue;
        }
        const segs = wallSegments(geo.track, grid * 0.06);
        const sig = hash([segs, def.blocks, def.source.animId, def.level]);
        // Unchanged (and none deleted by hand): leave them be
        if ( (mine.length === segs.length) && mine.every(w => w.getFlag(MODULE_ID, "effectWall").sig === sig) ) continue;
        remove.push(...mine.map(w => w.id));
        create.push(...segs.map(c => wallData(c, def, sig)));
      }
      // Walls of effect walls that no longer exist
      for ( const list of byWall.values() ) remove.push(...list.map(w => w.id));
      if ( remove.length ) await scene.deleteEmbeddedDocuments("Wall", remove, {[NO_HISTORY]: true});
      if ( create.length ) await scene.createEmbeddedDocuments("Wall", create, {[NO_HISTORY]: true});
    } catch(err) {
      console.error(`${MODULE_ID} | effect wall blocking`, err);
    } finally {
      this.#busy.delete(scene.id);
    }
    if ( this.#again.delete(scene.id) ) await this.sync(scene);
  }

  /** Growing walls become solid when they finish (on any scene): check now and then. */
  static start() {
    if ( this.#timer ) return;
    this.#timer = setInterval(() => {
      if ( !game.ready || !game.users.activeGM?.isSelf ) return;
      for ( const scene of game.scenes ) {
        const pending = sceneWalls(scene).some(w => (w.blocks !== "none") && !w.hidden && (w.reveal.mode === "grow")
          && (w.reveal.then === "stay") && (elapsedOf(w) < w.reveal.duration + 2));
        if ( pending ) this.sync(scene);
      }
    }, 1000);
  }

  static stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
