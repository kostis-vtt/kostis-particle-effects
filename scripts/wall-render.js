// Drawing effect walls: ribbon meshes painted by the line shader. Shared by the map, the studio preview and the
// thumbnails.

import {LINE_FRAGMENT, LINE_VERTEX, PAD, lineUniforms} from "./line-shader.js";
import {measureTrack, offsetTrack, ribbon, starChords} from "./wall-geometry.js";

/**
 * Meshes for a measured track (one per piece).
 * @param {object} track    From measureTrack
 * @param {object} look     A normalized look plus widthPx
 * @returns {PIXI.Mesh[]}
 */
export function wallMeshes(track, look) {
  const half = (look.widthPx / 2) * PAD;
  return track.pieces.map(pc => {
    const r = ribbon(pc, half);
    const geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", r.positions, 2)
      .addAttribute("aUv", r.uvs, 2)
      .addIndex(r.indices);
    const shader = PIXI.Shader.from(LINE_VERTEX, LINE_FRAGMENT, lineUniforms(look, null, track, 0));
    return new PIXI.Mesh(geometry, shader);
  });
}

/** Point the meshes at a look, a reveal window and a moment. */
export function updateWallMeshes(meshes, look, win, track, time, alpha=1) {
  const u = lineUniforms(look, win, track, time);
  u.uAlpha *= alpha;
  for ( const m of meshes ) Object.assign(m.shader.uniforms, u);
}

/** Only the uniforms that change every frame. */
export function tickWallMeshes(meshes, look, win, time, alpha=1) {
  for ( const m of meshes ) {
    const u = m.shader.uniforms;
    u.uTime = time;
    u.uRevA = win.a;
    u.uRevSpan = win.span;
    u.uTaper = win.taper;
    u.uFront = win.front;
    u.uBack = win.back ? 1 : 0;
    u.uAlpha = look.alpha * win.alpha * alpha;
  }
}

/* -------------------------------------------- */
/*  A wall and its layers                       */
/* -------------------------------------------- */

/**
 * Everything a wall draws: its own line, then each layer (a line beside it, a star across it), as meshes.
 * @param {object} track   From measureTrack
 * @param {object} look    A normalized look plus widthPx
 * @param {number} grid    Pixels per square (for the layers' widths and distances)
 * @returns {{kind: string, look: object, track?: object, chords?: object[], length?: number, meshes: PIXI.Mesh[]}[]}
 */
export function wallParts(track, look, grid) {
  const parts = [{kind: "line", look, track, meshes: wallMeshes(track, look)}];
  for ( const layer of look.layers ?? [] ) {
    const lk = {...layer, palette: layer.palette ?? look.palette, widthPx: layer.width * grid};
    if ( layer.kind === "star" ) {
      const chords = starChords(track, layer);
      parts.push({kind: "star", look: lk, chords, length: track.length, meshes: chords.map(c => wallMeshes(c, lk)[0])});
    } else {
      const side = offsetTrack(track, layer.offset * grid);
      parts.push({kind: "line", look: lk, track: side, meshes: wallMeshes(side, lk)});
    }
  }
  return parts;
}

/** What decides the shape of a wall's layers (they are rebuilt when it changes). */
export function layersKey(look) {
  return JSON.stringify((look.layers ?? []).map(l => [l.kind, l.width, l.offset, l.points, l.step, l.inset, l.turn]));
}

/** Give the parts a changed look (colours, speeds…) without rebuilding them: same layers, same shapes. */
export function setPartLooks(parts, look, grid) {
  const layers = look.layers ?? [];
  parts.forEach((p, i) => {
    if ( i === 0 ) p.look = look;
    else if ( layers[i - 1] ) p.look = {...layers[i - 1], palette: layers[i - 1].palette ?? look.palette, widthPx: layers[i - 1].width * grid};
  });
}

/** Every mesh of a wall's parts. */
export function partMeshes(parts) {
  return parts.flatMap(p => p.meshes);
}

/** A star lights up once its wall stands complete (the whole loop shown). */
function starShown(part, win) {
  return (win.span >= part.length - 1) && (win.alpha > 0) ? win.alpha : 0;
}

/** Point every part at a reveal window and a moment (their looks are their own). */
export function updateWallParts(parts, win, time, alpha=1) {
  for ( const p of parts ) {
    if ( p.kind !== "star" ) {
      updateWallMeshes(p.meshes, p.look, win, p.track, time, alpha);
      continue;
    }
    const shown = starShown(p, win);
    p.meshes.forEach((m, i) => {
      const c = p.chords[i];
      updateWallMeshes([m], p.look, {a: 0, span: c.length, alpha: shown, taper: 0, front: 0}, c, time, alpha);
    });
  }
}

/** Only what changes every frame. */
export function tickWallParts(parts, win, time, alpha=1) {
  for ( const p of parts ) {
    if ( p.kind !== "star" ) {
      tickWallMeshes(p.meshes, p.look, win, time, alpha);
      continue;
    }
    const shown = starShown(p, win);
    p.meshes.forEach((m, i) => tickWallMeshes([m], p.look, {a: 0, span: p.chords[i].length, alpha: shown, taper: 0, front: 0}, time, alpha));
  }
}

/** A gentle S-curve track for previews (in a box of the given size). */
export function previewTrack(w, h, margin=0.12) {
  const pts = [];
  const n = 120;
  for ( let i = 0; i <= n; i++ ) {
    const t = i / n;
    pts.push((margin + ((1 - (2 * margin)) * t)) * w, (h / 2) + (Math.sin(t * Math.PI * 2) * h * 0.22));
  }
  return measureTrack([{points: pts, closed: false}]);
}

const thumbs = new Map();

/** The stone floor wall thumbnails are drawn on (matches the thumbnail frames in the windows). */
const FLOOR = 0x3e3a35;

/** A loop for previews of looks with a star (a seal shows best round), from the top, clockwise. */
export function previewLoop(w, h, radius=0.36) {
  const r = Math.min(w, h) * radius;
  const pts = [];
  for ( let i = 0; i <= 120; i++ ) {
    const a = (-Math.PI / 2) + ((Math.PI * 2 * (i % 120)) / 120);
    pts.push((w / 2) + (Math.cos(a) * r), (h / 2) + (Math.sin(a) * r));
  }
  return measureTrack([{points: pts, closed: true}]);
}

/** The track a look is previewed on. */
export function previewTrackFor(look, w, h) {
  return (look.layers ?? []).some(l => l.kind === "star") ? previewLoop(w, h) : previewTrack(w, h);
}

/**
 * A data URL thumbnail of a wall look.
 * @param {object} look          A normalized look
 * @param {PIXI.Renderer} renderer
 */
export function wallThumbnail(look, renderer, w=160, h=96) {
  const key = JSON.stringify([look, w, h]);
  if ( thumbs.has(key) ) return thumbs.get(key);
  const track = previewTrackFor(look, w, h);
  const widthPx = Math.min(h * 0.32, Math.max(6, look.width * 22));
  // Layers keep their size next to the wall's own line
  const parts = wallParts(track, {...look, widthPx}, widthPx / Math.max(0.05, look.width));
  const rt = PIXI.RenderTexture.create({width: w, height: h, resolution: 1});
  const root = new PIXI.Container();
  // An opaque floor under it: the line shader adds light (colour brighter than its alpha), which a transparent texture
  // can't hold (reading it back divides by alpha and the colours wrap around)
  root.addChild(new PIXI.Graphics().beginFill(FLOOR).drawRect(0, 0, w, h).endFill());
  for ( const m of partMeshes(parts) ) root.addChild(m);
  updateWallParts(parts, {a: 0, span: track.length, alpha: 1, taper: 0, front: 0}, 1.7);
  try {
    renderer.render(root, {renderTexture: rt, clear: true});
    const url = renderer.extract.canvas(rt).toDataURL("image/webp", 0.9);
    thumbs.set(key, url);
    return url;
  } finally {
    root.destroy({children: true});
    rt.destroy(true);
  }
}
