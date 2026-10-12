// Textures painted by the particle shader:
// - live textures: one shared RenderTexture per look (and variant), re-rendered every frame so particles animate;
// - baked files: the image a particle token stores in its texture.src, uploaded once per look;
// - thumbnails and small emitter textures, kept in memory.

import {HUB_ID, MODULE_ID} from "./const.js";
import {createParticleMesh, updateParticleMesh} from "./shader.js";
import {normalizePreset, visualKey} from "./presets.js";

const hub = () => game.modules.get(HUB_ID)?.api;
const keyHash = preset => hub().math.hashId(visualKey(preset));

/** Seconds since the page loaded (all clients animate with their own smooth clock). */
const now = () => performance.now() / 1000;

/** Render a mesh into a texture (with the canvas renderer unless another is given). */
function renderTo(mesh, rt, renderer=canvas.app.renderer) {
  renderer.render(mesh, {renderTexture: rt, clear: true});
}

export class LiveTextures {
  /** @type {Map<string, {key, preset, rt, mesh, users: Set<string>, phase: number, idleSince: number|null}>} */
  static #entries = new Map();

  static #running = false;

  static #last = 0;

  /** Frames per second for live textures (0 = frozen). */
  static fps = 30;

  /** Multiplier on texture resolution. */
  static quality = 1;

  /**
   * The texture size for a look shown `px` pixels wide (at zoom 1): its own resolution, doubled for big tokens until
   * it covers them (2048 at most).
   */
  static tierOf(preset, px=0) {
    let res = preset.res;
    while ( (res < 2048) && (res < px) ) res *= 2;
    return res;
  }

  static keyOf(preset, variant=0, px=0) {
    return `${keyHash(preset)}:${variant}:${this.tierOf(normalizePreset(preset), px)}`;
  }

  /**
   * The key of the texture a token shows while its look is being edited: one texture, changed in place as the look
   * changes (a new texture for every step of a slider or a dragged point would pile up).
   */
  static editKey(id, preset, px=0) {
    return `edit:${id}:${this.tierOf(normalizePreset(preset), px)}`;
  }

  static get size() {
    return this.#entries.size;
  }

  /** How many users share a live texture (diagnostics). */
  static users(key) {
    return this.#entries.get(key)?.users.size ?? 0;
  }

  /**
   * A live texture for a look, shared by everyone who shows the same look and variant.
   * @param {object} preset
   * @param {string} user       Who is using it (a token id, an aura id…)
   * @param {object} [options]
   * @param {number} [options.variant]   Variants of one look run out of phase so a crowd doesn't pulse in sync
   * @param {string} [options.key]       A texture of its own (editKey) that takes this look
   */
  static acquire(preset, user, {variant=0, px=0, key}={}) {
    preset = normalizePreset(preset);
    const own = !!key;
    key ??= this.keyOf(preset, variant, px);
    let e = this.#entries.get(key);
    if ( e && own ) this.update(key, preset);
    if ( !e ) {
      const res = Math.max(32, Math.round(this.tierOf(preset, px) * this.quality));
      const rt = PIXI.RenderTexture.create({width: res, height: res, resolution: 1});
      const mesh = createParticleMesh(preset, res, 0);
      e = {key, preset, rt, mesh, users: new Set(), phase: variant * 1.618, idleSince: null};
      this.#entries.set(key, e);
      this.#render(e, now());
    }
    e.users.add(user);
    e.idleSince = null;
    this.#start();
    return e.rt;
  }

  /** Show another look in a texture of its own (editKey), at once. */
  static update(key, preset) {
    const e = this.#entries.get(key);
    if ( !e ) return;
    e.preset = normalizePreset(preset);
    updateParticleMesh(e.mesh, e.preset, now() + e.phase);
    this.#render(e, now());
  }

  /** Stop using a live texture. It is kept for a few seconds in case it is needed again. */
  static release(key, user) {
    const e = this.#entries.get(key);
    if ( !e ) return;
    e.users.delete(user);
    if ( !e.users.size ) e.idleSince = now();
  }

  static #render(e, t) {
    e.mesh.shader.uniforms.uTime = t + e.phase;
    renderTo(e.mesh, e.rt);
  }

  static #start() {
    if ( this.#running || !canvas?.app ) return;
    this.#running = true;
    canvas.app.ticker.add(this.#tick, this, PIXI.UPDATE_PRIORITY.HIGH);
  }

  static #tick() {
    const t = now();
    if ( !this.fps || ((t - this.#last) < (1 / this.fps) - 0.002) ) return;
    this.#last = t;
    for ( const e of this.#entries.values() ) {
      if ( e.users.size ) {
        this.#render(e, t);
        continue;
      }
      // Free textures nobody has used for a while
      if ( (e.idleSince !== null) && ((t - e.idleSince) > 5) ) this.#destroy(e);
    }
    if ( !this.#entries.size ) this.stop();
  }

  static #destroy(e) {
    this.#entries.delete(e.key);
    e.mesh.destroy();
    e.rt.destroy(true);
  }

  static stop() {
    if ( !this.#running ) return;
    canvas.app?.ticker?.remove(this.#tick, this);
    this.#running = false;
  }

  /** Drop everything (canvas teardown). */
  static clear() {
    this.stop();
    for ( const e of [...this.#entries.values()] ) this.#destroy(e);
  }
}

/* -------------------------------------------- */
/*  Baked images                                */
/* -------------------------------------------- */

/** The moment of the animation used for still images. */
const STILL_TIME = 1.3;

/** File name of a look's baked image. */
export function bakedName(preset) {
  const slug = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "particle";
  return `${preset.kind}-${slug}-${keyHash(preset)}.webp`;
}

/** Paint a look into a canvas element at a fixed time. */
export function paintCanvas(preset, size, time=STILL_TIME, renderer=canvas.app.renderer) {
  preset = normalizePreset(preset);
  const rt = PIXI.RenderTexture.create({width: size, height: size, resolution: 1});
  const mesh = createParticleMesh(preset, size, time);
  try {
    renderTo(mesh, rt, renderer);
    return renderer.extract.canvas(rt);
  } finally {
    mesh.destroy();
    rt.destroy(true);
  }
}

/** Encode a canvas element as a WebP (or PNG) blob. */
function toBlob(el) {
  return new Promise((resolve, reject) => {
    const done = b => (b ? resolve(b) : reject(new Error("Could not encode the particle image")));
    if ( el.convertToBlob ) el.convertToBlob({type: "image/webp", quality: 0.92}).then(done, reject);
    else el.toBlob(done, "image/webp", 0.92);
  });
}

/** Paths of looks baked this session (visual hash → path). */
const baked = new Map();

/**
 * Make sure a look's image exists as a file and return its path. Players without upload permission ask the GM.
 * @param {object} preset
 * @returns {Promise<string>}
 */
export async function bake(preset) {
  preset = normalizePreset(preset);
  const k = keyHash(preset);
  if ( baked.has(k) ) return baked.get(k);
  const storage = hub().storage;
  const dir = storage.dir("particles");
  const name = bakedName(preset);
  let path;
  if ( await storage.exists(dir, name) ) path = `${dir}/${name}`;
  else if ( storage.canUpload() ) path = await storage.upload(dir, name, await toBlob(paintCanvas(preset, preset.res)));
  else path = await hub().relay.call(`${MODULE_ID}.bake`, {preset});
  baked.set(k, path);
  return path;
}

/* -------------------------------------------- */
/*  In-memory textures                          */
/* -------------------------------------------- */

const thumbs = new Map();

/** A data URL thumbnail of a look (cached). */
export function thumbnail(preset, size=128, renderer) {
  preset = normalizePreset(preset);
  const k = `${keyHash(preset)}:${size}`;
  if ( !thumbs.has(k) ) thumbs.set(k, paintCanvas(preset, size, STILL_TIME, renderer).toDataURL("image/webp", 0.9));
  return thumbs.get(k);
}

const particleTextures = new Map();

/**
 * Static textures of a look for emitters: a few variants (different seeds and moments) so a stream of particles
 * doesn't look stamped. Kept on the GPU, never uploaded.
 */
export function emitterTextures(preset, {variants=3, size, renderer}={}) {
  preset = normalizePreset(preset);
  const res = size ?? Math.min(128, preset.res);
  const k = `${keyHash(preset)}:${variants}:${res}${renderer ? ":own" : ""}`;
  let list = renderer ? null : particleTextures.get(k);
  if ( list && list.every(t => t.valid && !t.baseTexture.destroyed) ) return list;
  list = [];
  for ( let i = 0; i < variants; i++ ) {
    const p = {...preset, seed: preset.seed + (i * 101)};
    const rt = PIXI.RenderTexture.create({width: res, height: res, resolution: 1});
    const mesh = createParticleMesh(p, res, STILL_TIME + (i * 0.77));
    renderTo(mesh, rt, renderer);
    mesh.destroy();
    list.push(rt);
  }
  if ( !renderer ) particleTextures.set(k, list);
  return list;
}

/** Forget GPU textures (canvas teardown). */
export function clearTextureCaches() {
  for ( const list of particleTextures.values() ) for ( const t of list ) t.destroy(true);
  particleTextures.clear();
  LiveTextures.clear();
}

export {updateParticleMesh};
