// Emitters: streams of particles from a token or a fixed point, run by Foundry's ParticleGenerator. Visual only and
// local to each client; the flags that describe them are shared, so everyone sees the same thing.

import {FLAG_EMITTERS, FLAG_PARTICLE, MODULE_ID, SOCKET} from "./const.js";
import {normalizeEmitter} from "./emitter-presets.js";
import {normalizePreset} from "./presets.js";
import {emitterTextures} from "./textures.js";
import {Library} from "./library.js";

const BLEND = () => ({add: PIXI.BLEND_MODES.ADD, screen: PIXI.BLEND_MODES.SCREEN, normal: PIXI.BLEND_MODES.NORMAL});
const TOKENS_LAYER = 700;

/**
 * Start a generator and lift its particles above tokens: Foundry leaves a generator's container on sort layer 0, under
 * tiles (500), drawings (600) and tokens (700) at the same elevation.
 * @param {ParticleGenerator} gen
 * @param {number} [layer]
 */
export function startGenerator(gen, layer=TOKENS_LAYER + 1) {
  gen.start();
  if ( gen.particlesContainer && ("sortLayer" in gen.particlesContainer) ) gen.particlesContainer.sortLayer = layer;
  return gen;
}

/** The particle look an emitter uses (resolving "inherit" from the token it is attached to). */
export function emitterParticle(emitter, sourcePreset=null) {
  if ( emitter.particle === "inherit" ) return sourcePreset ? normalizePreset(sourcePreset) : Library.get("particles", "builtin-spark");
  if ( typeof emitter.particle === "object" ) return normalizePreset(emitter.particle);
  return Library.get("particles", emitter.particle) ?? Library.get("particles", "builtin-spark");
}

/**
 * Translate an emitter preset into a ParticleGenerator configuration.
 * @param {object} emitter                   Normalized emitter
 * @param {object} options
 * @param {Function|object} options.anchor   A point, or a function returning the current point
 * @param {number} options.grid              Grid size in pixels
 * @param {PIXI.Texture[]} options.textures
 * @param {number} [options.footprint]       Token size in pixels (for the "token" area)
 * @param {number} [options.elevation]
 * @param {() => boolean} [options.active]   Spawning pauses while this returns false
 * @param {() => number} [options.elevationOf] Keep the particles at this elevation (a token that flies up or down)
 */
export function generatorConfig(emitter, {anchor, grid, textures, footprint=grid, elevation=0, active, elevationOf}) {
  const e = normalizeEmitter(emitter);
  const texSize = textures[0]?.width || 64;
  const px = sq => sq * grid;
  const half = e.spread / 2;
  let area;
  switch ( e.area ) {
    case "circle": area = {radius: px(e.radius)}; break;
    case "ring": area = {innerRadius: px(e.radius) * 0.85, outerRadius: px(e.radius)}; break;
    case "token": area = {x: -footprint / 2, y: -footprint / 2, width: footprint, height: footprint}; break;
    default: area = {x: 0, y: 0};
  }
  const g = px(e.gravity);
  const cfg = {
    mode: "effect",
    manual: true,
    anchor,
    area,
    count: e.count,
    lifetime: [e.lifeMin * 1000, e.lifeMax * 1000],
    fade: {in: e.fadeIn, out: e.fadeOut},
    alpha: [e.alphaMin, e.alphaMax],
    scale: e.grow === 1
      ? [px(e.sizeMin) / texSize, px(e.sizeMax) / texSize]
      : {min: px(e.sizeMin) / texSize, max: px(e.sizeMax) / texSize, curve: [{time: 0, value: 1}, {time: 1, value: e.grow}]},
    rotation: e.spin ? {speed: [-e.spin, e.spin]} : {},
    blend: BLEND()[e.blend],
    textures,
    elevation,
    sort: 1
  };
  if ( e.behavior === "orbit" ) {
    cfg.behavior = "orbit";
    cfg.orbit = {radius: [px(e.radius) * 0.6, px(e.radius)], angularSpeed: [e.orbitSpeed * 0.6, e.orbitSpeed], direction: "random"};
  } else if ( e.behavior === "follow" ) {
    cfg.behavior = "follow";
    cfg.follow = {stiffness: 0.35};
  }
  // Velocity: a polar launch, bent by gravity over each particle's life
  const speed = [px(e.speedMin), px(e.speedMax)];
  const angle = [e.angle - half, e.angle + half];
  if ( g ) {
    cfg.velocity = {fn: (p, dt, out) => {
      if ( !p._kpe ) {
        const a = Math.toRadians(angle[0] + (Math.random() * (angle[1] - angle[0])));
        const v = speed[0] + (Math.random() * (speed[1] - speed[0]));
        p._kpe = {vx: Math.cos(a) * v, vy: Math.sin(a) * v};
      }
      p._kpe.vy += g * (dt / 1000);
      out.x = p._kpe.vx;
      out.y = p._kpe.vy;
    }};
    cfg.onDeath = p => { p._kpe = null; };
  } else cfg.velocity = {speed, angle};

  // Spawning: steady rate (paused while the source is hidden), plus an optional burst
  let budget = 0;
  cfg.onTick = (dt, gen) => {
    if ( elevationOf && gen.particlesContainer ) {
      const z = elevationOf();
      if ( Number.isFinite(z) && (z !== gen.particlesContainer.elevation) ) gen.particlesContainer.elevation = z;
    }
    if ( !e.rate || (active && !active()) ) return;
    const room = gen.adjustedMaxParticles - gen.particles.length;
    budget += e.rate * (dt / 1000);
    const n = Math.min(Math.floor(budget), room);
    if ( n <= 0 ) {
      if ( room <= 0 ) budget = 0;
      return;
    }
    budget -= n;
    gen.spawnParticles(n);
  };
  return cfg;
}

export class Emitters {
  /** key → {gen, sig} where key is "token:<id>:<emitterId>" or "scene:<emitterId>" */
  static #running = new Map();

  /** Bring the running generators in line with the flags of the scene and its tokens. */
  static sync() {
    if ( !canvas?.ready || (game.settings.get(MODULE_ID, "emitters") === false) ) return this.clear();
    const wanted = new Map();
    const grid = canvas.dimensions.size;
    for ( const token of canvas.tokens.placeables ) {
      // deleteToken fires before the token's object is gone from the canvas
      if ( token.destroyed || token.isPreview || !canvas.scene.tokens.has(token.id) ) continue;
      const flags = token.document.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {};
      const source = token.document.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset ?? null;
      for ( const [id, raw] of Object.entries(flags) ) {
        if ( !raw?.emitter ) continue;
        wanted.set(`token:${token.id}:${id}`, {raw, source, token});
      }
    }
    for ( const [id, raw] of Object.entries(canvas.scene.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {}) ) {
      if ( raw?.emitter ) wanted.set(`scene:${id}`, {raw, point: {x: raw.x, y: raw.y}, elevation: raw.elevation ?? 0});
    }
    for ( const [key, run] of [...this.#running.entries()] ) {
      const w = wanted.get(key);
      if ( !w || (JSON.stringify(w.raw) !== run.sig) ) {
        // Let the last particles fade, then free everything
        run.gen.stop({hard: false});
        setTimeout(() => run.gen.stop({hard: true}), 4000);
        this.#running.delete(key);
      }
    }
    for ( const [key, w] of wanted ) {
      if ( this.#running.has(key) ) continue;
      const emitter = Library.get("emitters", w.raw.emitter);
      if ( !emitter || emitter.oneShot ) continue;
      const preset = emitterParticle(emitter, w.source);
      const textures = emitterTextures(preset);
      const tokenId = w.token?.id;
      const anchor = tokenId
        ? () => canvas.tokens.get(tokenId)?.center ?? {x: 0, y: 0}
        : w.point;
      const active = tokenId ? () => {
        const t = canvas.tokens.get(tokenId);
        return !!t && t.visible && !t.document.hidden;
      } : null;
      const cfg = generatorConfig(emitter, {
        anchor, grid, textures, active,
        footprint: w.token ? Math.max(w.token.w, w.token.h) : grid,
        elevation: w.token ? (w.token.document.elevation ?? 0) : (w.elevation ?? 0),
        elevationOf: tokenId ? () => canvas.tokens.get(tokenId)?.document.elevation ?? 0 : null
      });
      try {
        const gen = startGenerator(new foundry.canvas.animation.ParticleGenerator(cfg));
        this.#running.set(key, {gen, sig: JSON.stringify(w.raw)});
      } catch(err) {
        console.error(`${MODULE_ID} | emitter "${emitter.name}"`, err);
      }
    }
  }

  static get size() {
    return this.#running.size;
  }

  static clear() {
    for ( const run of this.#running.values() ) run.gen.stop({hard: true});
    this.#running.clear();
  }

  /* -------------------------------------------- */
  /*  One-shot bursts                             */
  /* -------------------------------------------- */

  /**
   * Play a one-off burst (an impact, an explosion) at a point for everyone on the scene.
   * @param {string|object} emitterRef
   * @param {{x:number, y:number}} point
   * @param {object} [options]
   * @param {object} [options.source]      The particle preset to inherit colours from
   * @param {number} [options.elevation]
   */
  static burst(emitterRef, point, {source=null, elevation=0, sceneId}={}) {
    const emitter = Library.get("emitters", emitterRef);
    if ( !emitter ) return;
    const msg = {type: "burst", emitter, point: {x: point.x, y: point.y}, source, elevation, sceneId: sceneId ?? canvas.scene?.id};
    game.socket?.emit(SOCKET, msg);
    this.playBurst(msg);
  }

  /** Play a burst locally. */
  static playBurst({emitter, point, source, elevation=0, sceneId}) {
    if ( !canvas?.ready || (sceneId && (sceneId !== canvas.scene?.id)) ) return;
    if ( game.settings.get(MODULE_ID, "emitters") === false ) return;
    const e = normalizeEmitter(emitter);
    const textures = emitterTextures(emitterParticle(e, source));
    const cfg = generatorConfig({...e, rate: 0}, {anchor: point, grid: canvas.dimensions.size, textures, elevation});
    cfg.sort = 2;
    try {
      const gen = startGenerator(new foundry.canvas.animation.ParticleGenerator(cfg), TOKENS_LAYER + 2);
      gen.spawnParticles(Math.max(1, e.burst || 30));
      setTimeout(() => {
        gen.stop({hard: false});
        setTimeout(() => gen.stop({hard: true}), (e.lifeMax * 1000) + 500);
      }, 50);
    } catch(err) {
      console.error(`${MODULE_ID} | burst`, err);
    }
  }

  /** Socket messages from other clients. */
  static onSocket(msg) {
    if ( msg?.type === "burst" ) this.playBurst(msg);
  }
}

export {TOKENS_LAYER};
