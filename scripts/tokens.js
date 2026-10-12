// Particle tokens: real tokens (they exist, can be targeted, damaged, animated) whose image is a procedural look.
// The stored image is a baked file; while this module is active the token shows a live, animated texture instead.

import {FLAG_EMITTERS, FLAG_PARTICLE, FLAG_SPAWN, HUB_ID, MODULE_ID, NO_HISTORY} from "./const.js";
import {normalizePreset} from "./presets.js";
import {LiveTextures, bake} from "./textures.js";
import {Library} from "./library.js";
import {controlData} from "./ownership.js";

const hub = () => game.modules.get(HUB_ID)?.api;

export class ParticleTokens {
  /**
   * What each token object shows. Keyed by the object, not the id: while a token is dragged Foundry draws a
   * preview copy with the same id, and that copy must never release the real token's texture.
   * @type {WeakMap<Token, {key: string, rt: PIXI.RenderTexture, user: string}>}
   */
  static #applied = new WeakMap();

  static #serial = 0;

  /** Looks shown on this client only, while being edited (token id → preset). */
  static #previews = new Map();

  /** The live-texture user name of a token object (preview copies get their own). */
  static #userOf(token) {
    return token.isPreview ? `${token.id}~preview${++this.#serial}` : token.id;
  }

  /** Show (or stop showing) the live texture of a token according to its flags. */
  static apply(token) {
    if ( !token?.mesh || token.destroyed ) return;
    const data = token.document.getFlag(MODULE_ID, FLAG_PARTICLE);
    const prev = this.#applied.get(token);
    const animate = game.settings.get(MODULE_ID, "animate") !== false;
    const override = this.#previews.get(token.id);
    if ( !(override ?? data?.preset) || !animate ) {
      if ( prev ) this.#restore(token, prev);
      return;
    }
    const preset = normalizePreset(override ?? data.preset);
    const variant = Number(data?.variant) || 0;
    // Big tokens get a sharper texture
    const px = Math.max(token.w || 0, token.h || 0);
    // A look being edited is shown in a texture of the token's own, changed in place
    const key = override ? LiveTextures.editKey(token.id, preset, px) : LiveTextures.keyOf(preset, variant, px);
    if ( prev && (prev.key === key) && (token.mesh.texture === prev.rt) ) {
      if ( override ) LiveTextures.update(key, preset);
      return;
    }
    const user = prev?.user ?? this.#userOf(token);
    if ( prev ) LiveTextures.release(prev.key, user);
    const rt = LiveTextures.acquire(preset, user, {variant, px, key: override ? key : undefined});
    token.mesh.texture = rt;
    token.renderFlags.set({refreshMesh: true});
    this.#applied.set(token, {key, rt, user});
  }

  static #restore(token, prev) {
    LiveTextures.release(prev.key, prev.user);
    this.#applied.delete(token);
    if ( token.mesh && token.texture ) {
      token.mesh.texture = token.texture;
      token.renderFlags.set({refreshMesh: true});
    }
  }

  /** A token object is going away (a real token or a drag preview). */
  static forget(token) {
    const prev = this.#applied.get(token);
    if ( !prev ) return;
    LiveTextures.release(prev.key, prev.user);
    this.#applied.delete(token);
  }

  /** Re-apply to every token on the canvas (after a settings change). */
  static applyAll() {
    for ( const t of canvas.tokens?.placeables ?? [] ) this.apply(t);
  }

  static clear() {
    this.#applied = new WeakMap();
    this.#previews.clear();
  }

  /**
   * Show a look on some tokens on this client only (live editing), or stop (preset null).
   * @param {string[]} ids
   * @param {object|null} preset
   */
  static previewLook(ids, preset) {
    for ( const id of ids ) {
      if ( preset ) this.#previews.set(id, normalizePreset(preset));
      else this.#previews.delete(id);
      const t = canvas.tokens?.get(id);
      if ( t ) this.apply(t);
    }
  }

  /** Tokens currently showing an unsaved look. */
  static get previewing() {
    return [...this.#previews.keys()];
  }

  /* -------------------------------------------- */
  /*  Creation                                    */
  /* -------------------------------------------- */

  /**
   * Token data for a particle centred on a point.
   * @param {object} preset          A particle preset (normalized or raw)
   * @param {object} options
   * @param {Scene} options.scene
   * @param {{x:number, y:number}} options.center
   * @param {string} options.src     The baked image
   * @param {number} [options.size]  Grid squares (defaults to the preset's)
   * @param {number} [options.elevation]
   * @param {number} [options.disposition]
   * @param {number} [options.variant]
   * @param {object} [options.spawn]       Lifetime bookkeeping (FLAG_SPAWN)
   * @param {object} [options.emitters]    Emitters to attach ({[id]: {emitter}})
   * @param {string} [options.by]          The user who made it
   * @param {object} [options.control]     Who controls it ({actorId, actorLink, delta} from controlData)
   */
  static tokenData(preset, {scene, center, src, size, elevation=0, disposition, variant=0, spawn, emitters, name, by, control}) {
    preset = normalizePreset(preset);
    const grid = scene.dimensions?.size ?? scene.grid?.size ?? 100;
    const distance = scene.dimensions?.distance ?? scene.grid?.distance ?? 5;
    const s = size ?? preset.token.size;
    const light = preset.token.light;
    const flags = {[FLAG_PARTICLE]: {preset, variant}};
    if ( by ) flags[FLAG_PARTICLE].by = by;
    if ( spawn ) flags[FLAG_SPAWN] = spawn;
    if ( emitters ) flags[FLAG_EMITTERS] = emitters;
    const data = {
      name: name ?? preset.name,
      x: center.x - ((s * grid) / 2),
      y: center.y - ((s * grid) / 2),
      elevation,
      width: s,
      height: s,
      lockRotation: preset.token.lockRotation,
      texture: {src, fit: "contain", scaleX: 1, scaleY: 1},
      displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
      displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
      disposition: disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      actorLink: false,
      sight: {enabled: false},
      flags: {[MODULE_ID]: flags}
    };
    if ( control?.actorId ) Object.assign(data, foundry.utils.deepClone(control));
    if ( light.radius > 0 ) {
      data.light = {
        dim: light.radius * distance,
        bright: light.radius * distance * 0.35,
        color: preset.palette[2],
        alpha: 0.25 + (0.35 * light.intensity),
        attenuation: 0.6,
        animation: light.animation === "none" ? {type: null} : {type: light.animation, speed: 4, intensity: 4}
      };
    }
    return data;
  }

  /**
   * Spawn particle tokens. Runs here when allowed, otherwise on the GM.
   * @param {string|object} presetRef        Preset id, name or data
   * @param {object} options
   * @param {{x:number, y:number}[]} options.centers
   * @param {string} [options.sceneId]
   * @returns {Promise<string[]>} the new token ids
   */
  static async spawn(presetRef, {centers, sceneId, size, elevation, disposition, spawn, emitters, name, owners}={}) {
    const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
    const preset = Library.get("particles", presetRef);
    if ( !scene || !preset || !centers?.length ) return [];
    const payload = {preset, centers, sceneId: scene.id, size, elevation, disposition, spawn, emitters, name, owners};
    // Particles are linked to the shared particle actor, which only a GM can set up: players go through the GM
    if ( game.user.isGM ) return this.spawnLocal(payload);
    return hub().relay.call(`${MODULE_ID}.spawn`, payload);
  }

  /** The part of spawn() that creates documents (also the GM side of the relay, for `user`). */
  static async spawnLocal({preset, centers, sceneId, size, elevation, disposition, spawn, emitters, name, owners}, user=game.user) {
    const scene = game.scenes.get(sceneId);
    if ( !scene ) throw new Error("Scene not found");
    preset = normalizePreset(preset);
    const src = await bake(preset);
    // Who controls them: as asked, else the GM's are the GM's and a player's are that player's
    const control = await controlData(owners ?? (!user || user.isGM ? "gm" : [user.id]));
    const data = centers.map((center, i) => this.tokenData(preset, {
      scene, center, src, size, elevation, disposition, spawn, emitters, name, variant: i % 3, by: user?.id ?? null, control
    }));
    const created = await scene.createEmbeddedDocuments("Token", data, {[NO_HISTORY]: true, [MODULE_ID]: {spawn: true}});
    return created.map(d => d.id);
  }

  /** Remove spawned particle tokens (all of them on a scene when no ids are given). */
  static async despawn(ids, {sceneId}={}) {
    const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
    if ( !scene ) return 0;
    const list = (ids ?? scene.tokens.filter(t => t.getFlag(MODULE_ID, FLAG_PARTICLE)).map(t => t.id))
      .filter(id => scene.tokens.has(id));
    if ( !list.length ) return 0;
    if ( !game.user.can("TOKEN_DELETE") && !game.user.isGM ) {
      return hub().relay.call(`${MODULE_ID}.despawn`, {ids: list, sceneId: scene.id});
    }
    await scene.deleteEmbeddedDocuments("Token", list, {[NO_HISTORY]: true, [MODULE_ID]: {despawn: true}});
    return list.length;
  }
}
