// The Mold tool (Kostis's Flying Paths controls): shape a placed particle by hand, right where it stands. Click a
// particle to pick it, then drag its points, drag an edge to pull out a new corner, or drag inside to move the whole
// outline; double-click a point to make it sharp or round, double-click an edge to add a point, right-click a point to
// remove it. Every change is one Ctrl+Z step.

import {FLAG_PARTICLE, HUB_ID, MODULE_ID, NO_HISTORY} from "./const.js";
import {OUTLINE_NODES, insertNode, moveNode, moveOutline, nearestNode, nearestOnOutline, normalizeOutline, outlineKey,
  outlinePoints, outlineShape, removeNode, toggleCorner} from "./outline.js";
import {normalizePreset} from "./presets.js";
import {ParticleTokens} from "./tokens.js";
import {bake} from "./textures.js";
import {remember, restore, snapshot} from "./undo.js";
import {selectedTokens} from "./selection.js";

const hub = () => game.modules.get(HUB_ID)?.api;

/** How close (screen pixels) the pointer must be to grab a point or an edge. */
const REACH = 10;

export class MoldTool {
  /** The particle being shaped (token id). */
  static #target = null;

  /** The outline while a gesture is under way: {mode, index, near, base, initial, start, outline}. */
  static #drag = null;

  static #graphics = null;

  static #hooks = [];

  /** Changes are saved one after another, in order. */
  static #queue = Promise.resolve();

  /** Outlines being saved (token id → {outline}): the points stay where they were left meanwhile. */
  static #pending = new Map();

  static #hinted = false;

  /** The tool is in use (a save finishing later must not draw points on the map). */
  static #active = false;

  /** The tool's canvas handlers (registered with the hub in tools.js). */
  static get handlers() {
    return {
      activate: () => this.#activate(),
      deactivate: () => this.#deactivate(),
      click: (event, p) => this.#click(event, p),
      doubleClick: (event, p) => this.#doubleClick(event, p),
      rightClick: (event, p) => this.#rightClick(event, p),
      dragStart: (event, p) => this.#dragStart(event, p),
      dragMove: (event, p) => this.#dragMove(event, p),
      dragDrop: (event, p) => this.#dragDrop(event, p),
      dragCancel: event => this.#dragCancel(event)
    };
  }

  /** The particle being shaped, if it is still there and yours to change. */
  static get target() {
    const doc = this.#target ? canvas.scene?.tokens.get(this.#target) : null;
    return doc?.getFlag(MODULE_ID, FLAG_PARTICLE) && doc.isOwner ? doc : null;
  }

  /** Shape this particle (a token, its document or its id; null to stop). */
  static select(token) {
    const id = typeof token === "string" ? token : (token?.document?.id ?? token?.id ?? null);
    if ( id !== this.#target ) this.#endDrag();
    this.#target = id;
    this.#draw();
  }

  /* -------------------------------------------- */
  /*  Geometry                                    */
  /* -------------------------------------------- */

  /** The particle's image square on the map: centre, half sizes (negative when mirrored) and turn. */
  static #frame(doc) {
    const t = doc.object;
    if ( !t ) return null;
    const half = Math.min(t.w, t.h) / 2;
    const angle = t.mesh?.rotation ?? 0;
    return {c: t.center, hx: half * (doc.texture?.scaleX || 1), hy: half * (doc.texture?.scaleY || 1), cos: Math.cos(angle), sin: Math.sin(angle)};
  }

  static #toWorld(f, p) {
    const x = p.x * f.hx;
    const y = p.y * f.hy;
    return {x: f.c.x + (x * f.cos) - (y * f.sin), y: f.c.y + (x * f.sin) + (y * f.cos)};
  }

  static #toLocal(f, w) {
    const dx = w.x - f.c.x;
    const dy = w.y - f.c.y;
    return {x: ((dx * f.cos) + (dy * f.sin)) / f.hx, y: ((-dx * f.sin) + (dy * f.cos)) / f.hy};
  }

  /** The outline shown for a particle (being saved, its own, or the circle it is molded from). */
  static #outlineOf(doc) {
    if ( this.#pending.has(doc.id) ) return this.#pending.get(doc.id).outline;
    return normalizeOutline(doc.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset?.outline) ?? outlineShape("circle");
  }

  /** Map distance for REACH screen pixels, in the particle's own units. */
  static #reach(f) {
    return REACH / (canvas.stage.scale.x * Math.max(1, Math.min(Math.abs(f.hx), Math.abs(f.hy))));
  }

  /** What is under a point: {kind: "node", index} | {kind: "edge", near} | {kind: "inside"} | null. */
  static #hit(doc, p) {
    const f = this.#frame(doc);
    if ( !f ) return null;
    const o = this.#drag?.outline ?? this.#outlineOf(doc);
    const q = this.#toLocal(f, p);
    const reach = this.#reach(f);
    const node = nearestNode(o, q);
    if ( node.distance <= reach ) return {kind: "node", index: node.index, q, o};
    const near = nearestOnOutline(o, q);
    if ( near.distance <= reach ) return {kind: "edge", near, q, o};
    const pts = outlinePoints(o, 12);
    let inside = false;
    for ( let i = 0, j = pts.length - 1; i < pts.length; j = i++ ) {
      const a = pts[i];
      const b = pts[j];
      if ( ((a.y > q.y) !== (b.y > q.y)) && (q.x < (((b.x - a.x) * (q.y - a.y)) / (b.y - a.y)) + a.x) ) inside = !inside;
    }
    return inside ? {kind: "inside", q, o} : null;
  }

  /** The topmost particle under a point that you may change (the smallest, when they overlap). */
  static #particleAt(p) {
    const hits = (canvas.tokens?.placeables ?? []).filter(t => t.visible && !t.isPreview && t.document.getFlag(MODULE_ID, FLAG_PARTICLE)
      && t.document.isOwner && t.bounds?.contains(p.x, p.y));
    hits.sort((a, b) => (a.w * a.h) - (b.w * b.h));
    return hits[0] ?? null;
  }

  /* -------------------------------------------- */
  /*  Drawing the points                          */
  /* -------------------------------------------- */

  static #graphicsLayer() {
    const overlay = hub()?.layer?.overlay(`${MODULE_ID}.mold`);
    if ( !overlay ) return null;
    if ( !this.#graphics || this.#graphics.destroyed || (this.#graphics.parent !== overlay) ) {
      this.#graphics = overlay.addChild(new PIXI.Graphics());
    }
    return this.#graphics;
  }

  static #draw() {
    if ( !this.#active ) {
      this.#graphics?.clear?.();
      return;
    }
    const g = this.#graphicsLayer();
    if ( !g ) return;
    g.clear();
    const doc = this.target;
    const f = doc ? this.#frame(doc) : null;
    if ( !f ) return;
    const s = 1 / (canvas.stage.scale.x || 1);
    const o = this.#drag?.outline ?? this.#outlineOf(doc);
    // The particle's square, faintly
    const box = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => this.#toWorld(f, {x, y}));
    g.lineStyle(s, 0xffffff, 0.3);
    g.moveTo(box[0].x, box[0].y);
    for ( const b of box.slice(1) ) g.lineTo(b.x, b.y);
    g.closePath();
    // The outline
    const pts = outlinePoints(o, 16).map(p => this.#toWorld(f, p));
    g.lineStyle(4 * s, 0x000000, 0.35);
    g.moveTo(pts[0].x, pts[0].y);
    for ( const p of pts.slice(1) ) g.lineTo(p.x, p.y);
    g.closePath();
    g.lineStyle(2 * s, 0xffffff, 0.95);
    g.moveTo(pts[0].x, pts[0].y);
    for ( const p of pts.slice(1) ) g.lineTo(p.x, p.y);
    g.closePath();
    // The points: round ones as circles, corners as squares
    for ( const n of o.nodes ) {
      const w = this.#toWorld(f, n);
      g.lineStyle(1.5 * s, 0xffffff, 1);
      if ( n.smooth > 0.5 ) {
        g.beginFill(0xb46cff, 1);
        g.drawCircle(w.x, w.y, 6 * s);
      } else {
        g.beginFill(0xffb347, 1);
        g.drawRect(w.x - (5.5 * s), w.y - (5.5 * s), 11 * s, 11 * s);
      }
      g.endFill();
    }
  }

  /* -------------------------------------------- */
  /*  Tool lifecycle                              */
  /* -------------------------------------------- */

  static #activate() {
    this.#active = true;
    // Start on the selected particle, if there is one
    if ( !this.target ) {
      const picked = selectedTokens().find(t => t.document.getFlag(MODULE_ID, FLAG_PARTICLE) && t.document.isOwner);
      if ( picked ) this.#target = picked.id;
    }
    const redraw = () => this.#draw();
    this.#hooks = [
      ["refreshToken", Hooks.on("refreshToken", t => { if ( t.id === this.#target ) redraw(); })],
      ["updateToken", Hooks.on("updateToken", d => { if ( d.id === this.#target ) redraw(); })],
      ["deleteToken", Hooks.on("deleteToken", d => { if ( d.id === this.#target ) this.select(null); })],
      ["canvasPan", Hooks.on("canvasPan", redraw)]
    ];
    if ( !this.#hinted ) ui.notifications.info("KPE.Info.Mold", {localize: true});
    this.#hinted = true;
    this.#draw();
  }

  static #deactivate() {
    this.#active = false;
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
    this.#endDrag();
    this.#graphics?.clear?.();
  }

  /* -------------------------------------------- */
  /*  Input                                       */
  /* -------------------------------------------- */

  static #click(_event, p) {
    const doc = this.target;
    // Clicks on the particle being shaped are for its points (a double-click acts on them)
    if ( doc && this.#hit(doc, p) ) return;
    const t = this.#particleAt(p);
    this.select(t ? t.document : null);
  }

  static #doubleClick(_event, p) {
    const doc = this.target;
    const hit = doc ? this.#hit(doc, p) : null;
    if ( hit?.kind === "node" ) return this.#save(doc, toggleCorner(hit.o, hit.index), "MoldCorner");
    if ( hit?.kind === "edge" ) return this.#save(doc, insertNode(hit.o, hit.near.segment, hit.near.x, hit.near.y), "MoldPoint");
  }

  static #rightClick(_event, p) {
    const doc = this.target;
    const hit = doc ? this.#hit(doc, p) : null;
    if ( hit?.kind === "node" ) return this.#save(doc, removeNode(hit.o, hit.index), "MoldRemove");
  }

  static #dragStart(_event, p) {
    let doc = this.target;
    let hit = doc ? this.#hit(doc, p) : null;
    // A drag on another particle picks it and moves its outline
    if ( !hit ) {
      const t = this.#particleAt(p);
      if ( !t ) return;
      this.select(t.document);
      doc = t.document;
      hit = this.#hit(doc, p);
      if ( !hit ) return;
    }
    const base = hit.o;
    this.#drag = {id: doc.id, mode: hit.kind === "inside" ? "move" : hit.kind, index: hit.index, near: hit.near, base, initial: base,
      start: hit.q, outline: base};
  }

  static #dragMove(_event, p) {
    const g = this.#drag;
    const doc = this.target;
    if ( !g || !doc || (doc.id !== g.id) ) return;
    const f = this.#frame(doc);
    if ( !f ) return;
    const q = this.#toLocal(f, p);
    if ( g.mode === "edge" ) {
      // Pulling an edge makes a new corner there (unless the outline has all the points it may have)
      if ( g.base.nodes.length >= OUTLINE_NODES.max ) {
        this.#drag = null;
        return this.#draw();
      }
      g.base = insertNode(g.base, g.near.segment, g.near.x, g.near.y);
      g.mode = "node";
      g.index = g.near.segment + 1;
    }
    // A point moves with the pointer from where it was grabbed
    const dx = q.x - g.start.x;
    const dy = q.y - g.start.y;
    if ( g.mode === "node" ) {
      const n = g.base.nodes[g.index];
      g.outline = moveNode(g.base, g.index, n.x + dx, n.y + dy);
    } else g.outline = moveOutline(g.base, dx, dy);
    // Shown at once on this client; saved when the drag ends
    const data = doc.getFlag(MODULE_ID, FLAG_PARTICLE);
    ParticleTokens.previewLook([doc.id], {...data.preset, outline: g.outline});
    this.#draw();
  }

  static #dragDrop(_event, _p) {
    const g = this.#drag;
    this.#drag = null;
    const doc = this.target;
    if ( !g || !doc || (doc.id !== g.id) ) return this.#draw();
    if ( outlineKey(g.outline) === outlineKey(g.initial) ) {
      this.#settle(doc.id);
      return this.#draw();
    }
    return this.#save(doc, g.outline, g.mode === "move" ? "MoldMove" : "Mold");
  }

  static #dragCancel() {
    this.#endDrag();
    this.#draw();
  }

  static #endDrag() {
    const g = this.#drag;
    this.#drag = null;
    if ( g ) this.#settle(g.id);
  }

  /** Show a particle as it is, or with the shape it is being given while that is saved. */
  static #settle(id) {
    const mark = this.#pending.get(id);
    const preset = mark ? canvas.scene?.tokens.get(id)?.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset : null;
    ParticleTokens.previewLook([id], preset ? {...preset, outline: mark.outline} : null);
  }

  /* -------------------------------------------- */
  /*  Saving                                      */
  /* -------------------------------------------- */

  /**
   * Give a particle a new outline (for everyone): its image is made first, the change is one undo step.
   * @returns {Promise<void>}
   */
  static #save(doc, outline, label) {
    const scene = doc.parent;
    const id = doc.id;
    outline = normalizeOutline(outline);
    const mark = {outline: outline ?? outlineShape("circle")};
    this.#pending.set(id, mark);
    this.#draw();
    const run = async () => {
      const current = scene.tokens.get(id);
      const data = current?.getFlag(MODULE_ID, FLAG_PARTICLE);
      if ( !data?.preset ) return;
      const preset = normalizePreset({...data.preset, outline});
      // Keep showing the new shape while its image is made
      ParticleTokens.previewLook([id], preset);
      try {
        const src = await bake(preset);
        const before = snapshot([current], ["texture.src"]);
        await current.update({"texture.src": src, flags: {[MODULE_ID]: {[FLAG_PARTICLE]: {preset, variant: data.variant ?? 0}}}},
          {[NO_HISTORY]: true});
        remember(game.i18n.format(`KPE.Undo.${label}`, {name: current.name}), () => restore(scene, before), scene);
      } catch(err) {
        console.error(`${MODULE_ID} | mold`, err);
        ui.notifications.error("KPE.Error.Mold", {localize: true});
      } finally {
        // (A later change to the same particle may already be waiting: it keeps its own outline shown)
        if ( this.#pending.get(id) === mark ) this.#pending.delete(id);
        if ( (this.#drag?.id !== id) && !this.#pending.has(id) ) ParticleTokens.previewLook([id], null);
        this.#draw();
      }
    };
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }
}
