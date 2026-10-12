// The studio's live preview: its own small PIXI app that shows a particle look animating, or a quick simulation
// of an emitter (an approximation of what Foundry's particle generator does on the map).

import {createParticleMesh, updateParticleMesh} from "./shader.js";
import {normalizePreset} from "./presets.js";
import {normalizeEmitter} from "./emitter-presets.js";
import {emitterTextures, thumbnail} from "./textures.js";
import {layersKey, partMeshes, previewTrackFor, setPartLooks, tickWallParts, updateWallParts, wallParts} from "./wall-render.js";
import {normalizeLook} from "./wall-presets.js";
import {lineTime} from "./line-shader.js";

const SIZE = 260;

export class Preview {
  app = null;

  #mode = null;

  #mesh = null;

  #preset = null;

  #sim = null;

  #layer = null;

  /** {key, parts, track} while showing a wall */
  #wall = null;

  /** Create the preview app (once) and put its canvas into an element. */
  mount(el) {
    if ( !el ) return;
    if ( !this.app ) {
      this.app = new PIXI.Application({width: SIZE, height: SIZE, backgroundAlpha: 0, antialias: true, autoStart: true});
      const bg = new PIXI.Graphics();
      for ( let x = 0; x < SIZE; x += 20 ) {
        for ( let y = 0; y < SIZE; y += 20 ) {
          bg.beginFill(((x + y) / 20) % 2 ? 0x2a2c33 : 0x23252b);
          bg.drawRect(x, y, 20, 20);
          bg.endFill();
        }
      }
      this.app.stage.addChild(bg);
      this.#layer = this.app.stage.addChild(new PIXI.Container());
      this.app.ticker.add(this.#tick, this);
    }
    if ( this.app.view.parentElement !== el ) el.replaceChildren(this.app.view);
  }

  get renderer() {
    return this.app?.renderer ?? null;
  }

  /** A cached thumbnail rendered by the preview's own renderer (works without a scene). */
  thumb(preset, size=96) {
    return thumbnail(preset, size, this.renderer ?? undefined);
  }

  /** Show a particle look. */
  showParticle(preset) {
    preset = normalizePreset(preset);
    this.#preset = preset;
    if ( this.#mode !== "particle" ) this.#clear();
    this.#mode = "particle";
    if ( !this.#mesh ) {
      this.#mesh = createParticleMesh(preset, SIZE, performance.now() / 1000);
      this.#layer.addChild(this.#mesh);
    } else updateParticleMesh(this.#mesh, preset, performance.now() / 1000);
  }

  /** Show a wall look painted along an S-curve (a seal, with a star, round a loop). */
  showWall(item) {
    const look = normalizeLook(item.look ?? item);
    const widthPx = Math.min(SIZE * 0.3, Math.max(6, look.width * 34));
    // Layers keep their size next to the wall's own line
    const grid = widthPx / Math.max(0.05, look.width);
    const key = JSON.stringify([widthPx, layersKey(look), look.layers.some(l => l.kind === "star")]);
    if ( (this.#mode !== "wall") || (this.#wall?.key !== key) ) {
      this.#clear();
      this.#mode = "wall";
      const track = previewTrackFor(look, SIZE, SIZE);
      const parts = wallParts(track, {...look, widthPx}, grid);
      for ( const m of partMeshes(parts) ) this.#layer.addChild(m);
      this.#wall = {key, parts, track};
    }
    setPartLooks(this.#wall.parts, {...look, widthPx}, grid);
    updateWallParts(this.#wall.parts, {a: 0, span: this.#wall.track.length, alpha: 1, taper: 0, front: 0}, lineTime());
  }

  /** Show an emitter streaming from the middle (with a faint token footprint for scale). */
  showEmitter(emitter, particle) {
    emitter = normalizeEmitter(emitter);
    const key = JSON.stringify([emitter, particle]);
    if ( (this.#mode === "emitter") && (this.#sim?.key === key) ) return;
    this.#clear();
    this.#mode = "emitter";
    const reach = Math.max(1, emitter.radius + (emitter.speedMax * emitter.lifeMax * 0.8) + (Math.abs(emitter.gravity) * emitter.lifeMax * 0.4));
    const grid = Math.max(24, Math.min(80, (SIZE * 0.45) / reach));
    const token = new PIXI.Graphics();
    token.lineStyle(1, 0xffffff, 0.25);
    token.beginFill(0xffffff, 0.04);
    token.drawCircle(SIZE / 2, SIZE / 2, grid / 2);
    token.endFill();
    this.#layer.addChild(token);
    const textures = emitterTextures(particle, {renderer: this.renderer, size: 64});
    this.#sim = {key, emitter, grid, textures, particles: [], budget: 0, since: 1e9, container: this.#layer.addChild(new PIXI.Container()), token};
  }

  #clear() {
    if ( this.#mesh ) {
      this.#mesh.destroy();
      this.#mesh = null;
    }
    if ( this.#wall ) {
      for ( const m of partMeshes(this.#wall.parts) ) m.destroy();
      this.#wall = null;
    }
    if ( this.#sim ) {
      this.#sim.container.destroy({children: true});
      this.#sim.token.destroy();
      for ( const t of this.#sim.textures ) t.destroy(true);
      this.#sim = null;
    }
    this.#layer?.removeChildren();
  }

  #tick() {
    const t = performance.now() / 1000;
    if ( this.#mode === "particle" && this.#mesh ) this.#mesh.shader.uniforms.uTime = t;
    if ( this.#mode === "wall" && this.#wall ) {
      tickWallParts(this.#wall.parts, {a: 0, span: this.#wall.track.length, alpha: 1, taper: 0, front: 0}, lineTime());
    }
    if ( this.#mode === "emitter" && this.#sim ) this.#step(Math.min(0.05, this.app.ticker.deltaMS / 1000));
  }

  /** Advance the emitter simulation by dt seconds. */
  #step(dt) {
    const s = this.#sim;
    const e = s.emitter;
    const g = s.grid;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const spawn = () => {
      const tex = s.textures[Math.floor(Math.random() * s.textures.length)];
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.blendMode = {add: PIXI.BLEND_MODES.ADD, screen: PIXI.BLEND_MODES.SCREEN, normal: PIXI.BLEND_MODES.NORMAL}[e.blend];
      let ox = 0;
      let oy = 0;
      const ang = Math.random() * Math.PI * 2;
      if ( e.area === "circle" ) {
        const r = Math.sqrt(Math.random()) * e.radius * g;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      } else if ( e.area === "ring" ) {
        const r = e.radius * g * (0.85 + (0.15 * Math.random()));
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      } else if ( e.area === "token" ) {
        ox = (Math.random() - 0.5) * g;
        oy = (Math.random() - 0.5) * g;
      }
      const dir = Math.toRadians(e.angle + ((Math.random() - 0.5) * e.spread));
      const v = (e.speedMin + (Math.random() * (e.speedMax - e.speedMin))) * g;
      const size = (e.sizeMin + (Math.random() * (e.sizeMax - e.sizeMin))) * g;
      const p = {
        sp, x: cx + ox, y: cy + oy, vx: Math.cos(dir) * v, vy: Math.sin(dir) * v, age: 0,
        life: e.lifeMin + (Math.random() * (e.lifeMax - e.lifeMin)),
        base: e.alphaMin + (Math.random() * (e.alphaMax - e.alphaMin)),
        size, spin: (Math.random() - 0.5) * 2 * e.spin,
        orbitR: Math.hypot(ox, oy) || (e.radius * g), orbitA: Math.atan2(oy, ox),
        orbitW: Math.toRadians(e.orbitSpeed * (0.6 + (0.4 * Math.random()))) * (Math.random() < 0.5 ? -1 : 1)
      };
      s.container.addChild(sp);
      s.particles.push(p);
    };
    if ( e.oneShot ) {
      s.since += dt;
      if ( s.since > Math.max(1.2, e.lifeMax + 0.4) ) {
        s.since = 0;
        for ( let i = 0; i < Math.min(e.count, e.burst || 30); i++ ) spawn();
      }
    } else {
      s.budget += e.rate * dt;
      while ( (s.budget >= 1) && (s.particles.length < e.count) ) {
        s.budget -= 1;
        spawn();
      }
      if ( s.particles.length >= e.count ) s.budget = 0;
    }
    for ( let i = s.particles.length - 1; i >= 0; i-- ) {
      const p = s.particles[i];
      p.age += dt;
      const k = p.age / p.life;
      if ( k >= 1 ) {
        p.sp.destroy();
        s.particles.splice(i, 1);
        continue;
      }
      if ( e.behavior === "orbit" ) {
        p.orbitA += p.orbitW * dt;
        p.x = cx + (Math.cos(p.orbitA) * p.orbitR);
        p.y = cy + (Math.sin(p.orbitA) * p.orbitR);
      } else {
        p.vy += e.gravity * g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      const fadeIn = e.fadeIn > 0 ? Math.min(1, k / e.fadeIn) : 1;
      const fadeOut = e.fadeOut > 0 ? Math.min(1, (1 - k) / e.fadeOut) : 1;
      p.sp.alpha = p.base * fadeIn * fadeOut;
      const sz = p.size * (1 + ((e.grow - 1) * k));
      p.sp.width = p.sp.height = Math.max(1, sz);
      p.sp.angle += p.spin * dt;
      p.sp.position.set(p.x, p.y);
    }
  }

  destroy() {
    this.#clear();
    this.app?.destroy(true, {children: true, texture: true, baseTexture: true});
    this.app = null;
  }
}
