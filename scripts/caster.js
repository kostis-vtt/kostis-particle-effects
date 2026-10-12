// Casting effects (spawn → animate → trail → impact → clean up) and the GM-side janitor that ends them.

import {ANIMATOR_ID, DEL, FLAG_AURAS, FLAG_CASTS, FLAG_PARTICLE, FLAG_SPAWN, HUB_ID, MODULE_ID, NO_HISTORY} from "./const.js";
import {normalizeEffect} from "./effect-presets.js";
import {Library} from "./library.js";
import {ParticleTokens} from "./tokens.js";
import {Emitters} from "./emitters.js";
import {selectedTokens} from "./selection.js";
import {ownersOf} from "./ownership.js";

const hub = () => game.modules.get(HUB_ID)?.api;
const animator = () => {
  const m = game.modules.get(ANIMATOR_ID);
  return m?.active ? m.api : null;
};
const serverNow = () => game.time.serverTime;
const centerOf = d => {
  const grid = d.parent?.dimensions?.size ?? 100;
  return {x: d.x + ((d.width * grid) / 2), y: d.y + ((d.height * grid) / 2)};
};

/** Resolve token references (ids, tokens, documents) on a scene. */
function docsOf(list, scene) {
  return (list ?? []).map(t => {
    if ( typeof t === "string" ) return scene.tokens.get(t);
    if ( t?.document ) return t.document;
    return t;
  }).filter(d => d && (d.parent === scene));
}

/** The animator template an effect flies with, or null. */
function templateOf(effect) {
  if ( !effect.animation ) return null;
  return animator()?.templates().find(t => t.id === effect.animation) ?? null;
}

/** Does an effect need targeted tokens? */
export function effectNeedsTargets(effect) {
  const tpl = templateOf(effect);
  if ( !tpl ) return effect.spawnAt === "target";
  const homing = (tpl.steps ?? []).some(s => (s.enabled !== false) && (s.shape?.type === "homing") && ((s.shape.to ?? "target") === "target"));
  const follows = (tpl.motion?.anchor === "token") && ((tpl.motion.anchorToken ?? "target") === "target") && (effect.anchor !== "caster");
  return homing || follows || (effect.spawnAt === "target");
}

export class Caster {
  /**
   * Cast an effect.
   * @param {string|object} effectRef               Effect id, name or data
   * @param {object} [options]
   * @param {Token|TokenDocument|string} [options.caster]   Defaults to the first selected token
   * @param {Array} [options.targets]                Defaults to the user's targets
   * @param {{x:number, y:number}} [options.point]   Where to spawn for "point" effects
   * @returns {Promise<{cast: string, tokens: string[]}|null>}
   */
  static async cast(effectRef, {caster, targets, point}={}) {
    const effect = Library.get("effects", effectRef);
    const scene = canvas.scene;
    if ( !effect || !scene ) return null;
    const casterDoc = docsOf([caster ?? selectedTokens()[0]], scene)[0] ?? null;
    let targetDocs = targets ? docsOf(targets, scene) : [...game.user.targets].map(t => t.document).filter(d => d?.parent === scene);
    targetDocs = targetDocs.filter(d => d.id !== casterDoc?.id);
    if ( effect.animation && !animator() ) {
      ui.notifications.warn("KPE.Warn.NeedsAnimator", {localize: true});
      return null;
    }
    if ( (effect.spawnAt === "caster") && !casterDoc ) {
      ui.notifications.warn("KPE.Warn.NeedsCaster", {localize: true});
      return null;
    }
    if ( effectNeedsTargets(effect) && !targetDocs.length ) {
      ui.notifications.warn("KPE.Warn.NeedsTarget", {localize: true});
      return null;
    }
    if ( (effect.spawnAt === "point") && !point ) {
      ui.notifications.warn("KPE.Warn.NeedsPoint", {localize: true});
      return null;
    }
    const payload = {effect, casterId: casterDoc?.id ?? null, targetIds: targetDocs.map(d => d.id), point: point ?? null, sceneId: scene.id};
    // Casts write to the scene (its animations and cast records), which only GMs may do: players go through the GM
    if ( game.user.isGM ) return this.castLocal(payload, game.user);
    return hub().relay.call(`${MODULE_ID}.cast`, payload);
  }

  /** The part of cast() that changes documents (also the GM side of the relay). */
  static async castLocal({effect, casterId, targetIds=[], point, sceneId}, user) {
    effect = normalizeEffect(effect);
    const scene = game.scenes.get(sceneId);
    if ( !scene ) throw new Error("Scene not found");
    const casterDoc = casterId ? scene.tokens.get(casterId) ?? null : null;
    const targetDocs = targetIds.map(id => scene.tokens.get(id)).filter(Boolean);
    const preset = Library.get("particles", effect.particle);
    if ( !preset ) throw new Error(`Unknown particle "${effect.particle}"`);
    const castId = foundry.utils.randomID(10);
    const grid = scene.dimensions.size;

    // Where the particles appear
    let centers = [];
    if ( effect.spawnAt === "target" ) centers = targetDocs.map(centerOf);
    else if ( effect.spawnAt === "point" && point ) centers = [point];
    else if ( casterDoc ) centers = [centerOf(casterDoc)];
    if ( !centers.length ) return null;
    if ( effect.count > 1 ) {
      // Several particles start in a small ring around each spawn point
      const out = [];
      for ( const c of centers ) {
        for ( let i = 0; i < effect.count; i++ ) {
          const a = (i / effect.count) * Math.PI * 2;
          out.push({x: c.x + (Math.cos(a) * grid * 0.4), y: c.y + (Math.sin(a) * grid * 0.4)});
        }
      }
      centers = out;
    }

    const spawn = {
      cast: castId,
      lifetime: effect.lifetime,
      until: effect.lifetime === "timed" ? serverNow() + (effect.seconds * 1000) : null,
      impact: effect.impact,
      caster: casterDoc?.id ?? null,
      by: user?.id ?? game.user.id
    };
    const emitters = effect.trail ? {trail: {emitter: effect.trail}} : undefined;
    // Who controls them: whoever controls the caster (a player's boss: that player), only the GM, or everyone
    let owners = effect.owners;
    if ( owners === "caster" ) owners = casterDoc ? ownersOf(casterDoc) : (!user || user.isGM ? "gm" : [user.id]);
    const ids = await ParticleTokens.spawnLocal({
      preset, centers, sceneId, size: effect.size ?? undefined, elevation: casterDoc?.elevation ?? 0,
      disposition: casterDoc?.disposition, spawn, emitters, owners
    }, user);

    // An aura on the caster for as long as the cast lasts
    if ( effect.casterAura && casterDoc ) {
      const aura = Library.get("particles", effect.casterAura);
      if ( aura ) await casterDoc.update({[`flags.${MODULE_ID}.${FLAG_AURAS}.${castId}`]: {preset: aura, cast: castId}}, {[NO_HISTORY]: true});
    }

    // Fly them
    if ( effect.animation ) {
      const kaa = animator();
      const aim = (effect.anchor === "caster") && casterDoc ? [casterDoc.id, ...targetDocs.map(d => d.id)] : targetDocs.map(d => d.id);
      const anim = kaa ? await kaa.applyTemplate(effect.animation, ids, {scene: scene.id, targets: aim, rate: effect.rate}) : null;
      const started = ids.some(id => scene.tokens.get(id)?.getFlag(ANIMATOR_ID, "playback"));
      if ( !anim || !started ) {
        if ( anim ) await kaa.deleteAnimation(anim.id, {scene: scene.id});
        await ParticleTokens.despawn(ids, {sceneId});
        return null;
      }
      await Janitor.adopt(scene, anim.id, castId);
    }
    Hooks.callAll(`${MODULE_ID}.cast`, {effect, cast: castId, tokens: ids, caster: casterDoc, targets: targetDocs});
    return {cast: castId, tokens: ids};
  }
}

/* -------------------------------------------- */
/*  Janitor                                     */
/* -------------------------------------------- */

export class Janitor {
  static #interval = null;

  static #ticking = false;

  /**
   * Remember the animation made for a cast, in the scene (so whichever GM cleans up, even after a reload, can delete
   * it once the cast is over).
   */
  static adopt(scene, animId, castId) {
    return scene.update({flags: {[MODULE_ID]: {[FLAG_CASTS]: {[castId]: {animId, at: serverNow()}}}}}, {[NO_HISTORY]: true});
  }

  static get isGM() {
    return !!game.users.activeGM?.isSelf;
  }

  static start() {
    if ( this.#interval ) return;
    this.#interval = setInterval(() => this.#tick(), 1000);
  }

  static stop() {
    clearInterval(this.#interval);
    this.#interval = null;
  }

  /** A spawned token's animation ended: impact, then remove it if it only lived for the animation. */
  static async onUpdateToken(doc, changed) {
    const spawn = doc.getFlag(MODULE_ID, FLAG_SPAWN);
    if ( !spawn || !this.isGM ) return;
    const base = `flags.${ANIMATOR_ID}`;
    const touched = foundry.utils.hasProperty(changed, `${base}.playback`) || foundry.utils.hasProperty(changed, `${base}.-=playback`);
    if ( !touched || doc.getFlag(ANIMATOR_ID, "playback") ) return;
    if ( spawn.impact ) {
      Emitters.burst(spawn.impact, centerOf(doc), {source: doc.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset, elevation: doc.elevation,
        sceneId: doc.parent.id});
    }
    if ( spawn.lifetime === "animation" ) await this.#remove(doc.parent, [doc.id]);
  }

  /** Symmetry copies removed by the animator at the end of their run still get their impact. */
  static onDeleteToken(doc, options) {
    const spawn = doc.getFlag(MODULE_ID, FLAG_SPAWN);
    if ( !spawn?.impact || !this.isGM || !options?.[ANIMATOR_ID]?.despawn ) return;
    Emitters.burst(spawn.impact, centerOf(doc), {source: doc.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset, elevation: doc.elevation,
      sceneId: doc.parent.id});
  }

  static async #remove(scene, ids) {
    const live = ids.filter(id => scene.tokens.has(id));
    if ( live.length ) await scene.deleteEmbeddedDocuments("Token", live, {[NO_HISTORY]: true, [MODULE_ID]: {despawn: true}});
  }

  /** Timed lifetimes, leftover caster auras and cast animations. */
  static async #tick() {
    // A slow server can make a tick outlast the interval: never run two at once (they would delete the same tokens)
    if ( !this.isGM || this.#ticking ) return;
    this.#ticking = true;
    try {
      await this.#sweep();
    } catch(err) {
      console.error(`${MODULE_ID} | janitor`, err);
    } finally {
      this.#ticking = false;
    }
  }

  static async #sweep() {
    const now = serverNow();
    for ( const scene of game.scenes ) {
      // Read the cast records before the tokens: a cast that starts while this sweep awaits must not look finished
      const casts = Object.entries(scene.getFlag(MODULE_ID, FLAG_CASTS) ?? {});
      const expired = [];
      const liveCasts = new Set();
      for ( const t of scene.tokens ) {
        const spawn = t.getFlag(MODULE_ID, FLAG_SPAWN);
        if ( !spawn ) continue;
        // Only particle tokens are ever despawned, whatever flags another token may carry
        if ( (spawn.lifetime === "timed") && spawn.until && (spawn.until <= now) ) {
          if ( t.getFlag(MODULE_ID, FLAG_PARTICLE) ) expired.push(t.id);
        } else liveCasts.add(spawn.cast);
      }
      if ( expired.length ) await this.#remove(scene, expired);
      // Caster auras whose cast is over
      for ( const t of scene.tokens ) {
        const auras = t.getFlag(MODULE_ID, FLAG_AURAS) ?? {};
        const done = Object.entries(auras).filter(([, a]) => a?.cast && !liveCasts.has(a.cast)).map(([id]) => id);
        if ( done.length ) {
          const gone = Object.fromEntries(done.map(id => [id, DEL()]));
          await t.update({flags: {[MODULE_ID]: {[FLAG_AURAS]: gone}}}, {[NO_HISTORY]: true});
        }
      }
      // Animations made for casts that are over
      const over = casts.filter(([castId, c]) => c && !liveCasts.has(castId) && !((now - (c.at ?? 0)) < 3000));
      if ( over.length ) {
        const kaa = animator();
        for ( const [, c] of over ) {
          if ( !c.animId || !kaa?.getAnimation?.(c.animId, scene) ) continue;
          try {
            await kaa.deleteAnimation(c.animId, {scene: scene.id});
          } catch(err) {
            console.debug(`${MODULE_ID} | cast animation already gone`, err);
          }
        }
        await scene.update({flags: {[MODULE_ID]: {[FLAG_CASTS]: Object.fromEntries(over.map(([id]) => [id, DEL()]))}}},
          {[NO_HISTORY]: true});
      }
    }
  }
}
