// The outline editor: an outline's points drawn over a particle's preview (the studio and the manager), to mold it by
// hand. Drag a point to move it, drag an edge to pull a new corner out of it, drag inside to move the whole outline;
// double-click a point to make it sharp or round, double-click an edge to add a point, right-click a point to remove
// it. Or draw the outline in one stroke. Points are found by where the pointer is: their elements are redrawn as the
// outline changes, and a captured pointer's clicks land on the editor itself.

import {OUTLINE_NODES, OUTLINE_SHAPES, freehandOutline, insertNode, mirrorOutline, moveNode, moveOutline, nearestNode,
  nearestOnOutline, normalizeOutline, outlineKey, outlinePoints, outlineShape, removeNode, setSmooth, toggleCorner} from "./outline.js";

const SVG = "http://www.w3.org/2000/svg";

/** How close (in outline units: the preview is 2 wide) the pointer must be to grab a point. */
const NODE_REACH = 0.07;

/** How close it must be to grab the edge. */
const EDGE_REACH = 0.07;

/** How far the pointer moves before a press becomes a drag (a click changes nothing). */
const DRAG_START = 0.02;

const el = (name, attrs={}) => {
  const e = document.createElementNS(SVG, name);
  for ( const [k, v] of Object.entries(attrs) ) e.setAttribute(k, String(v));
  return e;
};

/** Is a point inside a closed list of points? */
function inside(points, p) {
  let hit = false;
  for ( let i = 0, j = points.length - 1; i < points.length; j = i++ ) {
    const a = points[i];
    const b = points[j];
    if ( ((a.y > p.y) !== (b.y > p.y)) && (p.x < (((b.x - a.x) * (p.y - a.y)) / (b.y - a.y)) + a.x) ) hit = !hit;
  }
  return hit;
}

export class OutlineEditor {
  /**
   * @param {HTMLElement} host     The preview box to draw over
   * @param {object} options
   * @param {() => (object|null)} options.get                      The outline (null: the plain circle)
   * @param {(outline: object|null, final: boolean) => void} options.set   A change; final once the gesture ends
   */
  constructor(host, {get, set}) {
    this.host = host;
    this.get = get;
    this.set = set;
    /** Drawing a whole new outline with the next stroke. */
    this.drawing = false;
    this.#gesture = null;
    this.svg = el("svg", {viewBox: "-1 -1 2 2", preserveAspectRatio: "none", class: "kpe-outline-editor"});
    host.classList.add("kpe-molding");
    host.append(this.svg);
    this.svg.addEventListener("pointerdown", this.#onDown);
    this.svg.addEventListener("pointermove", this.#onMove);
    this.svg.addEventListener("pointerup", this.#onUp);
    this.svg.addEventListener("pointercancel", this.#onCancel);
    this.svg.addEventListener("dblclick", this.#onDouble);
    this.svg.addEventListener("contextmenu", this.#onContext);
    this.render();
  }

  /** {mode: "node"|"edge"|"move"|"draw", ...} while the pointer is down. */
  #gesture;

  /** The outline being edited (a circle until it is first molded). */
  get outline() {
    return normalizeOutline(this.get()) ?? outlineShape("circle");
  }

  /** Draw the outline with the next stroke on the preview. */
  startDrawing() {
    this.drawing = true;
    this.render();
  }

  destroy() {
    this.svg.remove();
    this.host.classList.remove("kpe-molding");
  }

  /** Where an event is, in outline units. */
  #local(event) {
    const r = this.svg.getBoundingClientRect();
    return {x: (((event.clientX - r.left) / Math.max(1, r.width)) * 2) - 1, y: (((event.clientY - r.top) / Math.max(1, r.height)) * 2) - 1};
  }

  /** Redraw the curve and its points (or the stroke being drawn). */
  render() {
    this.svg.replaceChildren();
    this.svg.classList.toggle("kpe-drawing", this.drawing);
    if ( this.#gesture?.mode === "draw" ) {
      this.svg.append(el("polyline", {class: "kpe-ol-stroke", points: this.#gesture.points.map(p => `${p.x},${p.y}`).join(" ")}));
      return;
    }
    if ( this.drawing ) return;
    const o = this.#gesture?.outline ?? this.outline;
    const pts = outlinePoints(o, 16);
    this.svg.append(el("path", {class: "kpe-ol-curve", d: `M${pts.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join("L")}Z`}));
    o.nodes.forEach((n, i) => {
      const attrs = {"class": `kpe-ol-node ${n.smooth > 0.5 ? "smooth" : "sharp"}`, "data-index": i};
      this.svg.append(n.smooth > 0.5 ? el("circle", {...attrs, cx: n.x, cy: n.y, r: 0.045})
        : el("rect", {...attrs, x: n.x - 0.04, y: n.y - 0.04, width: 0.08, height: 0.08}));
    });
  }

  #emit(outline, final) {
    this.set(normalizeOutline(outline), final);
  }

  /** What is at a point: one of the outline's points, its edge, or its inside (null: none of them). */
  #hit(o, p) {
    const node = nearestNode(o, p);
    if ( node.distance <= NODE_REACH ) return {kind: "node", index: node.index};
    const near = nearestOnOutline(o, p);
    if ( near.distance <= EDGE_REACH ) return {kind: "edge", near};
    return inside(outlinePoints(o, 12), p) ? {kind: "inside"} : null;
  }

  #onDown = event => {
    if ( event.button !== 0 ) return;
    const p = this.#local(event);
    const base = this.outline;
    this.svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if ( this.drawing ) {
      this.#gesture = {mode: "draw", points: [p]};
      return this.render();
    }
    const hit = this.#hit(base, p);
    if ( !hit ) return;
    // `initial` tells whether the gesture changed anything; `before` is put back if it is cancelled
    this.#gesture = {mode: hit.kind === "inside" ? "move" : hit.kind, index: hit.index, near: hit.near, base, initial: base,
      before: normalizeOutline(this.get()), start: p, outline: base, dragging: false};
  };

  #onMove = event => {
    const g = this.#gesture;
    if ( !g ) return;
    const p = this.#local(event);
    if ( g.mode === "draw" ) {
      const last = g.points.at(-1);
      if ( Math.hypot(p.x - last.x, p.y - last.y) > 0.01 ) g.points.push(p);
      return this.render();
    }
    // A press only becomes a drag once the pointer has really moved
    if ( !g.dragging ) {
      if ( Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_START ) return;
      g.dragging = true;
      if ( g.mode === "edge" ) {
        // Pulling an edge makes a new corner there (unless the outline has all the points it may have)
        if ( g.base.nodes.length >= OUTLINE_NODES.max ) {
          this.#gesture = null;
          return;
        }
        g.base = insertNode(g.base, g.near.segment, g.near.x, g.near.y);
        g.mode = "node";
        g.index = g.near.segment + 1;
      }
    }
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    // A point moves with the pointer from where it was grabbed
    if ( g.mode === "node" ) {
      const n = g.base.nodes[g.index];
      g.outline = moveNode(g.base, g.index, n.x + dx, n.y + dy);
    } else if ( g.mode === "move" ) g.outline = moveOutline(g.base, dx, dy);
    this.#emit(g.outline, false);
    this.render();
  };

  #onUp = event => {
    const g = this.#gesture;
    this.#gesture = null;
    this.svg.releasePointerCapture?.(event.pointerId);
    if ( !g ) return;
    if ( g.mode === "draw" ) {
      this.drawing = false;
      const drawn = freehandOutline(g.points);
      if ( drawn ) this.#emit(drawn, true);
      return this.render();
    }
    // A click without a drag changes nothing (and redraws nothing: a double-click may follow)
    if ( outlineKey(g.outline) === outlineKey(g.initial) ) return;
    this.#emit(g.outline, true);
    this.render();
  };

  #onCancel = () => {
    const g = this.#gesture;
    this.#gesture = null;
    if ( !g ) return;
    if ( g.mode === "draw" ) this.drawing = false;
    // Put back what was there before the gesture
    else if ( outlineKey(g.outline) !== outlineKey(g.initial) ) this.set(g.before, true);
    this.render();
  };

  #onDouble = event => {
    if ( this.drawing ) return;
    event.preventDefault();
    const base = this.outline;
    const hit = this.#hit(base, this.#local(event));
    if ( hit?.kind === "node" ) this.#emit(toggleCorner(base, hit.index), true);
    else if ( (hit?.kind === "edge") && (base.nodes.length < OUTLINE_NODES.max) ) {
      this.#emit(insertNode(base, hit.near.segment, hit.near.x, hit.near.y), true);
    } else return;
    this.render();
  };

  #onContext = event => {
    const base = this.outline;
    const hit = this.#hit(base, this.#local(event));
    if ( hit?.kind !== "node" ) return;
    event.preventDefault();
    this.#emit(removeNode(base, hit.index), true);
    this.render();
  };
}

/* -------------------------------------------- */
/*  In an app                                   */
/* -------------------------------------------- */

/** What the shared outline tools (templates/outline-tools.hbs) show. */
export function outlineToolsContext(outline, molding) {
  return {molding, molded: !!outline, shapes: Object.entries(OUTLINE_SHAPES).map(([value, s]) => ({value, label: s.label}))};
}

/** The outline buttons and the points over an app's preview (the studio and the manager use one each). */
export class MoldControls {
  /**
   * @param {object} options
   * @param {() => (object|null)} options.get                      The outline being edited
   * @param {(outline: object|null, final: boolean) => void} options.set
   */
  constructor({get, set}) {
    this.get = get;
    this.set = set;
  }

  /** The points are shown over the preview. */
  molding = false;

  /** @type {OutlineEditor|null} */
  editor = null;

  #drawNext = false;

  /** Put the points over a preview element (after every render), or take them away (null). */
  attach(preview) {
    this.editor?.destroy();
    this.editor = this.molding && preview ? new OutlineEditor(preview, {get: this.get, set: this.set}) : null;
    if ( this.editor && this.#drawNext ) this.editor.startDrawing();
    this.#drawNext = false;
  }

  /**
   * One of the outline buttons (data-action moldToggle, moldDraw, moldSharp, moldRound, moldMirror, moldReset).
   * @returns {boolean} whether the app should render again
   */
  action(name) {
    const base = normalizeOutline(this.get());
    switch ( name ) {
      case "moldToggle":
        this.molding = !this.molding;
        return true;
      case "moldDraw":
        this.molding = true;
        this.#drawNext = true;
        return true;
      case "moldSharp":
      case "moldRound":
        if ( base ) this.set(setSmooth(base, name === "moldSharp" ? 0 : 1), true);
        return true;
      case "moldMirror":
        if ( base ) this.set(mirrorOutline(base), true);
        return true;
      case "moldReset":
        this.set(null, true);
        return true;
    }
    return false;
  }

  /** Start from one of the shapes (the "Start from a shape" list). */
  shape(name) {
    if ( !OUTLINE_SHAPES[name] ) return;
    this.molding = true;
    this.set(outlineShape(name, {seed: Math.floor(Math.random() * 1e6)}), true);
  }

  destroy() {
    this.editor?.destroy();
    this.editor = null;
  }
}
