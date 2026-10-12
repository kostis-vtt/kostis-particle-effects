// Auras: animated looks drawn around a token (a ring of fire, a rune circle underfoot, a shield bubble), stored in
// the token's flags so everyone sees them. They follow the token's displayed position, including animator motion.

import {FLAG_AURAS, MODULE_ID} from "./const.js";
import {normalizePreset} from "./presets.js";
import {LiveTextures} from "./textures.js";

const TOKENS_LAYER = 700;

/** Normalize one aura entry. */
export function normalizeAura(a={}) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    preset: a.preset ? normalizePreset(a.preset) : null,
    scale: Math.min(10, Math.max(0.2, num(a.scale, 1))),
    below: a.below !== false,
    alpha: Math.min(1, Math.max(0.05, num(a.alpha, 1))),
    spin: num(a.spin, 0)
  };
}

export class Auras {
  /** token id → Map(aura id → {container, sprite, key, def}) */
  static #drawn = new Map();

  static #running = false;

  /** Create, update or remove the aura sprites of a token to match its flags. */
  static sync(token) {
    if ( !token?.document || token.destroyed ) return;
    const flags = token.document.getFlag(MODULE_ID, FLAG_AURAS) ?? {};
    let mine = this.#drawn.get(token.id);
    const wanted = new Set();
    for ( const [id, raw] of Object.entries(flags) ) {
      if ( !raw ) continue;
      const def = normalizeAura(raw);
      if ( !def.preset ) continue;
      wanted.add(id);
      mine ??= new Map();
      this.#drawn.set(token.id, mine);
      // Big auras get a sharper texture (the look's body fills `size` of the drawn square)
      const px = (Math.max(token.w || 0, token.h || 0) * def.scale) / Math.max(0.1, normalizePreset(def.preset).look.size);
      const key = LiveTextures.keyOf(def.preset, 0, px);
      let entry = mine.get(id);
      if ( entry && (entry.key !== key) ) {
        this.#remove(token.id, id, entry);
        entry = null;
      }
      if ( !entry ) {
        const user = `${token.id}.aura.${id}`;
        const rt = LiveTextures.acquire(def.preset, user, {px});
        const container = new foundry.canvas.primary.PrimaryCanvasParticleContainer();
        const sprite = new PIXI.Sprite(rt);
        sprite.anchor.set(0.5);
        sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
        container.addChild(sprite);
        canvas.primary.addChild(container);
        entry = {container, sprite, key, def, user};
        mine.set(id, entry);
      }
      entry.def = def;
      entry.container.sortLayer = def.below ? TOKENS_LAYER - 1 : TOKENS_LAYER + 1;
    }
    for ( const [id, entry] of [...(mine?.entries() ?? [])] ) if ( !wanted.has(id) ) this.#remove(token.id, id, entry);
    if ( mine && !mine.size ) this.#drawn.delete(token.id);
    this.#update(token);
    this.#start();
  }

  static #remove(tokenId, id, entry) {
    LiveTextures.release(entry.key, entry.user);
    entry.container.destroy({children: true});
    this.#drawn.get(tokenId)?.delete(id);
  }

  /** A token is going away. */
  static forget(tokenId) {
    const mine = this.#drawn.get(tokenId);
    if ( !mine ) return;
    for ( const [id, entry] of [...mine.entries()] ) this.#remove(tokenId, id, entry);
    this.#drawn.delete(tokenId);
  }

  static syncAll() {
    for ( const t of canvas.tokens?.placeables ?? [] ) this.sync(t);
  }

  static clear() {
    for ( const id of [...this.#drawn.keys()] ) this.forget(id);
    this.#stop();
  }

  /** Follow the token: position, size, elevation, visibility and spin. */
  static #update(token) {
    const mine = this.#drawn.get(token.id);
    if ( !mine ) return;
    const doc = token.document;
    const c = token.center;
    const side = Math.max(token.w, token.h);
    const t = performance.now() / 1000;
    for ( const entry of mine.values() ) {
      const {def, container, sprite} = entry;
      container.elevation = doc.elevation ?? 0;
      container.position.set(c.x, c.y);
      container.visible = token.visible && !token.document.hidden;
      // The look's body (its "size" in the quad) is matched to the token's footprint, times the aura scale
      const quad = (side * def.scale) / Math.max(0.1, def.preset.look.size);
      sprite.width = sprite.height = quad;
      sprite.alpha = def.alpha * (token.document.alpha ?? 1);
      sprite.angle = def.spin ? (t * def.spin) % 360 : 0;
    }
  }

  static #start() {
    if ( this.#running || !this.#drawn.size ) return;
    this.#running = true;
    canvas.app.ticker.add(this.#tick, this, PIXI.UPDATE_PRIORITY.OBJECTS - 1);
  }

  static #stop() {
    if ( !this.#running ) return;
    canvas.app?.ticker?.remove(this.#tick, this);
    this.#running = false;
  }

  static #tick() {
    if ( !this.#drawn.size ) return this.#stop();
    for ( const id of this.#drawn.keys() ) {
      const token = canvas.tokens.get(id);
      if ( !token ) {
        this.forget(id);
        continue;
      }
      this.#update(token);
    }
  }
}
