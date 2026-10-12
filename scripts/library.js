// The library: built-in particles, emitters, effects and walls plus the user's own, saved in a world setting so every
// client sees the same list. A built-in can be changed for the world: its edited version is stored under its own id
// (everything that refers to it uses it) until it is reset.

import {MODULE_ID} from "./const.js";
import {BUILTIN_PRESETS, normalizePreset} from "./presets.js";
import {BUILTIN_EMITTERS, normalizeEmitter} from "./emitter-presets.js";
import {BUILTIN_EFFECTS, normalizeEffect} from "./effect-presets.js";
import {BUILTIN_WALLS, normalizeWallPreset} from "./wall-presets.js";

export const TYPES = {
  particles: {builtins: () => BUILTIN_PRESETS, normalize: normalizePreset},
  emitters: {builtins: () => BUILTIN_EMITTERS, normalize: normalizeEmitter},
  effects: {builtins: () => BUILTIN_EFFECTS, normalize: normalizeEffect},
  walls: {builtins: () => BUILTIN_WALLS, normalize: normalizeWallPreset}
};

const newId = () => foundry.utils.randomID(16);

export class Library {
  /** The stored user data ({particles: {}, emitters: {}, effects: {}}). */
  static #raw() {
    const v = game.settings.get(MODULE_ID, "library") ?? {};
    return {particles: v.particles ?? {}, emitters: v.emitters ?? {}, effects: v.effects ?? {}, walls: v.walls ?? {}};
  }

  /** Every item of a type: built-ins first (as edited in this world), then the user's own (normalized). */
  static all(type) {
    const t = TYPES[type];
    const raw = this.#raw()[type];
    const builtins = t.builtins();
    const ids = new Set(builtins.map(b => b.id));
    const shown = builtins.map(b => (raw[b.id] ? {...t.normalize({...raw[b.id], id: b.id}), builtin: true, category: b.category, edited: true} : b));
    const mine = Object.entries(raw).filter(([id, x]) => x && !ids.has(id)).map(([, x]) => ({...t.normalize(x), builtin: false, category: "mine"}));
    return [...shown, ...mine];
  }

  /** A built-in as it ships (null for the user's own). */
  static original(type, id) {
    return TYPES[type].builtins().find(b => b.id === id) ?? null;
  }

  /** Has this built-in been changed in this world? */
  static edited(type, id) {
    return !!this.original(type, id) && !!this.#raw()[type][id];
  }

  static mine(type) {
    return this.all(type).filter(x => !x.builtin);
  }

  /** One item by id (or name), or null. */
  static get(type, idOrName) {
    if ( !idOrName ) return null;
    if ( typeof idOrName === "object" ) return TYPES[type].normalize(idOrName);
    const list = this.all(type);
    return list.find(x => x.id === idOrName) ?? list.find(x => x.name === idOrName) ?? null;
  }

  /**
   * Save an item. A built-in is changed for this world (reset brings it back); with `copy`, or without an id, it is a
   * new item of the user's own.
   * @param {string} type
   * @param {object} data
   * @param {object} [options]
   * @param {boolean} [options.copy=false]
   * @returns {Promise<object>} the saved item
   */
  static async save(type, data, {copy=false}={}) {
    const raw = foundry.utils.deepClone(this.#raw());
    const item = TYPES[type].normalize(data);
    const original = !copy && item.builtin ? this.original(type, item.id) : null;
    if ( original ) {
      raw[type][item.id] = {...item, builtin: true, category: original.category};
      await game.settings.set(MODULE_ID, "library", raw);
      return {...item, builtin: true, category: original.category, edited: true};
    }
    if ( copy || !item.id || item.builtin || !raw[type][item.id] ) item.id = newId();
    item.builtin = false;
    item.category = "mine";
    raw[type][item.id] = item;
    await game.settings.set(MODULE_ID, "library", raw);
    return item;
  }

  /** Bring back a built-in as it ships. */
  static async reset(type, id) {
    const raw = foundry.utils.deepClone(this.#raw());
    if ( !this.original(type, id) || !raw[type][id] ) return false;
    delete raw[type][id];
    await game.settings.set(MODULE_ID, "library", raw);
    return true;
  }

  static async delete(type, id) {
    const raw = foundry.utils.deepClone(this.#raw());
    if ( !raw[type][id] ) return false;
    delete raw[type][id];
    await game.settings.set(MODULE_ID, "library", raw);
    return true;
  }
}
