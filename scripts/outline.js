// Outlines: the shape a particle is molded into. An outline is a closed loop of nodes in the particle's own square
// (-1..1 on each axis, y down like the image), each node a sharp corner or a smooth curve. The shader reads it as a
// radius for every direction from the centre, so every look (rings, glows, rune bands, shields) follows the outline.
// Pure functions: the studio, the manager and the map tool all edit outlines through these.

/** Fewest and most nodes an outline may have. */
export const OUTLINE_NODES = {min: 3, max: 48};

/** Directions the shader knows the outline's radius in. */
export const PROFILE_SIZE = 128;

/** Radii are stored as 16-bit fractions of this (a molded shape may reach into the corners of its square: √2). */
export const PROFILE_MAX = 1.5;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = v => Math.round(v * 10000) / 10000;
const node = (x, y, smooth=0) => ({x: round(clamp(x, -1, 1)), y: round(clamp(y, -1, 1)), smooth: round(clamp(smooth, 0, 1))});

/** A clean outline, or null (a plain circle) when there is none or it is unusable. */
export function normalizeOutline(o) {
  if ( !o || !Array.isArray(o.nodes) ) return null;
  const nodes = o.nodes.slice(0, OUTLINE_NODES.max)
    .filter(n => n && Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y)))
    .map(n => node(Number(n.x), Number(n.y), num(n.smooth, 0)));
  return nodes.length >= OUTLINE_NODES.min ? {nodes} : null;
}

/** A short stable text for an outline ("" for none). */
export function outlineKey(o) {
  return o?.nodes ? o.nodes.map(n => `${n.x},${n.y},${n.smooth}`).join(";") : "";
}

/* -------------------------------------------- */
/*  Shapes to start from                        */
/* -------------------------------------------- */

const ring = (count, radius, {start=-Math.PI / 2, smooth=0, rx=radius, ry=radius}={}) => Array.from({length: count}, (_, i) => {
  const a = start + ((Math.PI * 2 * i) / count);
  return node(Math.cos(a) * rx, Math.sin(a) * ry, smooth);
});

/** Seeded random numbers (the same blob for the same seed). */
function rng(seed) {
  let s = (Math.abs(Math.round(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Outlines to start molding from. */
export const OUTLINE_SHAPES = {
  // (Molding starts from this circle: as big as the plain look, its points just inside the square)
  circle: {label: "Circle", make: () => ring(8, 0.97, {smooth: 1})},
  oval: {label: "Oval", make: () => ring(8, 0.95, {smooth: 1, ry: 0.6})},
  square: {label: "Square", make: () => [node(-0.9, -0.9), node(0.9, -0.9), node(0.9, 0.9), node(-0.9, 0.9)]},
  wide: {label: "Wide rectangle", make: () => [node(-0.95, -0.55), node(0.95, -0.55), node(0.95, 0.55), node(-0.95, 0.55)]},
  diamond: {label: "Diamond", make: () => ring(4, 0.96)},
  triangle: {label: "Triangle", make: () => ring(3, 0.96)},
  hexagon: {label: "Hexagon", make: () => ring(6, 0.95, {start: 0})},
  octagon: {label: "Octagon", make: () => ring(8, 0.95, {start: Math.PI / 8})},
  star: {label: "Star", make: () => Array.from({length: 10}, (_, i) => {
    const a = (-Math.PI / 2) + ((Math.PI * i) / 5);
    const r = i % 2 ? 0.42 : 0.96;
    return node(Math.cos(a) * r, Math.sin(a) * r);
  })},
  heart: {label: "Heart", make: () => [node(0, -0.4), node(0.45, -0.86, 1), node(0.9, -0.4, 1), node(0.55, 0.32, 1), node(0, 0.92),
    node(-0.55, 0.32, 1), node(-0.9, -0.4, 1), node(-0.45, -0.86, 1)]},
  drop: {label: "Drop", make: () => [node(0, -0.96), node(0.55, 0.05, 1), node(0.5, 0.62, 1), node(0, 0.9, 1), node(-0.5, 0.62, 1),
    node(-0.55, 0.05, 1)]},
  shield: {label: "Shield", make: () => [node(-0.85, -0.85), node(0.85, -0.85), node(0.8, 0.05, 1), node(0, 0.95), node(-0.8, 0.05, 1)]},
  arch: {label: "Arch (doorway)", make: () => [node(-0.7, 0.95), node(0.7, 0.95), node(0.7, -0.15, 1), node(0.5, -0.75, 1), node(0, -0.95, 1),
    node(-0.5, -0.75, 1), node(-0.7, -0.15, 1)]},
  blob: {label: "Random blob", make: ({seed=Date.now()}={}) => {
    const r = rng(seed);
    const n = 6 + Math.floor(r() * 3);
    return Array.from({length: n}, (_, i) => {
      const a = (-Math.PI / 2) + ((Math.PI * 2 * (i + ((r() - 0.5) * 0.4))) / n);
      const d = 0.6 + (r() * 0.36);
      return node(Math.cos(a) * d, Math.sin(a) * d, 1);
    });
  }}
};

/** A new outline of one of the shapes above. */
export function outlineShape(name, options) {
  const s = OUTLINE_SHAPES[name] ?? OUTLINE_SHAPES.circle;
  return {nodes: s.make(options)};
}

/* -------------------------------------------- */
/*  The curve                                   */
/* -------------------------------------------- */

/** Catmull-Rom tangent of node i, scaled by its smoothness (a sharp corner has none). */
function tangent(nodes, i) {
  const n = nodes.length;
  const a = nodes[(i + n - 1) % n];
  const b = nodes[(i + 1) % n];
  const k = 0.5 * nodes[i].smooth;
  return {x: (b.x - a.x) * k, y: (b.y - a.y) * k};
}

/** The point at t (0..1) of the curve from node i to the next. */
export function segmentPoint(o, i, t) {
  const nodes = o.nodes;
  const n = nodes.length;
  const p0 = nodes[i];
  const p1 = nodes[(i + 1) % n];
  const m0 = tangent(nodes, i);
  const m1 = tangent(nodes, (i + 1) % n);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = (2 * t3) - (3 * t2) + 1;
  const h10 = t3 - (2 * t2) + t;
  const h01 = (-2 * t3) + (3 * t2);
  const h11 = t3 - t2;
  return {x: (h00 * p0.x) + (h10 * m0.x) + (h01 * p1.x) + (h11 * m1.x), y: (h00 * p0.y) + (h10 * m0.y) + (h01 * p1.y) + (h11 * m1.y)};
}

/** The closed curve as points (the last one joins the first; it is not repeated). */
export function outlinePoints(o, perSegment=24) {
  const out = [];
  for ( let i = 0; i < o.nodes.length; i++ ) {
    for ( let k = 0; k < perSegment; k++ ) out.push(segmentPoint(o, i, k / perSegment));
  }
  return out;
}

/**
 * How far the outline reaches from the centre in each of `size` directions (angles from -π, clockwise on screen as y
 * points down): the farthest crossing of the outline, 0 where a direction never meets it.
 * @returns {Float32Array}
 */
export function radialProfile(o, size=PROFILE_SIZE) {
  const out = new Float32Array(size);
  if ( !o?.nodes ) return out.fill(1);
  const pts = outlinePoints(o, 16);
  const n = pts.length;
  for ( let j = 0; j < size; j++ ) {
    const a = -Math.PI + ((Math.PI * 2 * (j + 0.5)) / size);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0;
    for ( let i = 0; i < n; i++ ) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = (dx * ey) - (dy * ex);
      if ( Math.abs(den) < 1e-12 ) continue;
      const t = ((p.x * ey) - (p.y * ex)) / den;
      const s = ((p.x * dy) - (p.y * dx)) / den;
      if ( (t > best) && (s >= 0) && (s <= 1) ) best = t;
    }
    out[j] = Math.min(PROFILE_MAX, best);
  }
  return out;
}

/** The profile as texture data: 16 bits per direction in red (high byte) and green (low byte). */
export function encodeProfile(profile, data=new Uint8Array(profile.length * 4)) {
  for ( let j = 0; j < profile.length; j++ ) {
    const v = Math.round((clamp(profile[j], 0, PROFILE_MAX) / PROFILE_MAX) * 65535);
    data.set([v >> 8, v & 255, 0, 255], j * 4);
  }
  return data;
}

/** Read one direction back from texture data (what the shader does). */
export function decodeProfile(data, j) {
  return (((data[j * 4] * 256) + data[(j * 4) + 1]) / 65535) * PROFILE_MAX;
}

/* -------------------------------------------- */
/*  Editing                                     */
/* -------------------------------------------- */

const copy = o => ({nodes: o.nodes.map(n => ({...n}))});

/** Move one node (kept inside the particle's square). */
export function moveNode(o, i, x, y) {
  const out = copy(o);
  if ( out.nodes[i] ) out.nodes[i] = node(x, y, out.nodes[i].smooth);
  return out;
}

/** Move every node by the same amount (the whole outline slides; it stays inside the square). */
export function moveOutline(o, dx, dy) {
  const xs = o.nodes.map(n => n.x);
  const ys = o.nodes.map(n => n.y);
  dx = clamp(dx, -1 - Math.min(...xs), 1 - Math.max(...xs));
  dy = clamp(dy, -1 - Math.min(...ys), 1 - Math.max(...ys));
  return {nodes: o.nodes.map(n => node(n.x + dx, n.y + dy, n.smooth))};
}

/** Scale and turn the whole outline about the centre. */
export function transformOutline(o, {scale=1, angle=0}={}) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {nodes: o.nodes.map(n => node(((n.x * c) - (n.y * s)) * scale, ((n.x * s) + (n.y * c)) * scale, n.smooth))};
}

/** Remove a node (an outline keeps at least three). */
export function removeNode(o, i) {
  if ( o.nodes.length <= OUTLINE_NODES.min ) return o;
  const out = copy(o);
  out.nodes.splice(i, 1);
  return out;
}

/** Turn a node from a smooth curve into a sharp corner, or back. */
export function toggleCorner(o, i) {
  const out = copy(o);
  if ( out.nodes[i] ) out.nodes[i].smooth = out.nodes[i].smooth > 0.5 ? 0 : 1;
  return out;
}

/** Every node sharp (a polygon) or every node round. */
export function setSmooth(o, smooth) {
  return {nodes: o.nodes.map(n => node(n.x, n.y, smooth))};
}

/**
 * Add a node on the curve after node `i` at (x, y). On a straight edge it is a sharp corner (pull it out to make a new
 * edge); on a curve it is smooth.
 */
export function insertNode(o, i, x, y) {
  if ( o.nodes.length >= OUTLINE_NODES.max ) return o;
  const out = copy(o);
  const a = out.nodes[i];
  const b = out.nodes[(i + 1) % out.nodes.length];
  const smooth = (a.smooth > 0) || (b.smooth > 0) ? 1 : 0;
  out.nodes.splice(i + 1, 0, node(x, y, smooth));
  return out;
}

/** The node nearest to p, and how far it is. */
export function nearestNode(o, p) {
  let best = {index: -1, distance: Infinity};
  o.nodes.forEach((n, index) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if ( d < best.distance ) best = {index, distance: d};
  });
  return best;
}

/** The point of the curve nearest to p: which segment it is on, where, and how far it is. */
export function nearestOnOutline(o, p, perSegment=32) {
  let best = {segment: -1, x: 0, y: 0, distance: Infinity};
  for ( let i = 0; i < o.nodes.length; i++ ) {
    for ( let k = 0; k <= perSegment; k++ ) {
      const q = segmentPoint(o, i, k / perSegment);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if ( d < best.distance ) best = {segment: i, x: q.x, y: q.y, distance: d};
    }
  }
  return best;
}

/** Ramer–Douglas–Peucker on a closed list of points. */
function simplifyLoop(points, epsilon) {
  if ( points.length < 4 ) return points;
  // Split the loop at its two farthest-apart points so both halves keep their corners
  let far = 1;
  let fd = -1;
  for ( let i = 1; i < points.length; i++ ) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if ( d > fd ) {
      fd = d;
      far = i;
    }
  }
  const half = (list) => {
    const keep = new Uint8Array(list.length);
    keep[0] = keep[list.length - 1] = 1;
    const stack = [[0, list.length - 1]];
    while ( stack.length ) {
      const [a, b] = stack.pop();
      const A = list[a];
      const B = list[b];
      const ex = B.x - A.x;
      const ey = B.y - A.y;
      const L2 = (ex * ex) + (ey * ey);
      let best = -1;
      let bd = epsilon;
      for ( let i = a + 1; i < b; i++ ) {
        const t = L2 > 0 ? clamp((((list[i].x - A.x) * ex) + ((list[i].y - A.y) * ey)) / L2, 0, 1) : 0;
        const d = Math.hypot(list[i].x - (A.x + (ex * t)), list[i].y - (A.y + (ey * t)));
        if ( d > bd ) {
          bd = d;
          best = i;
        }
      }
      if ( best >= 0 ) {
        keep[best] = 1;
        stack.push([a, best], [best, b]);
      }
    }
    return list.filter((_, i) => keep[i]);
  };
  const first = half(points.slice(0, far + 1));
  const second = half([...points.slice(far), points[0]]);
  return [...first, ...second.slice(1, -1)];
}

/**
 * An outline from a hand-drawn line (closed automatically): simplified to its main points, sharp where the line turns
 * hard and smooth elsewhere. Null when the drawing is too small to be a shape.
 */
export function freehandOutline(points) {
  const pts = points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(p => ({x: clamp(p.x, -1, 1), y: clamp(p.y, -1, 1)}));
  if ( pts.length < 3 ) return null;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  if ( Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 0.1 ) return null;
  let eps = 0.03;
  let simple = simplifyLoop(pts, eps);
  while ( (simple.length > 32) && (eps < 0.5) ) simple = simplifyLoop(pts, eps *= 1.4);
  if ( simple.length < 3 ) return null;
  const n = simple.length;
  const nodes = simple.map((p, i) => {
    const a = simple[(i + n - 1) % n];
    const b = simple[(i + 1) % n];
    const ang = Math.abs(Math.atan2(((p.x - a.x) * (b.y - p.y)) - ((p.y - a.y) * (b.x - p.x)),
      ((p.x - a.x) * (b.x - p.x)) + ((p.y - a.y) * (b.y - p.y))));
    return node(p.x, p.y, ang > 1 ? 0 : 1);
  });
  return normalizeOutline({nodes});
}

/** Make the outline symmetric: its left half, mirrored onto the right. */
export function mirrorOutline(o) {
  const nodes = o.nodes;
  const n = nodes.length;
  const left = i => nodes[i].x <= 0.001;
  // The longest run of left-side nodes, in loop order
  let bestStart = -1;
  let bestLen = 0;
  for ( let s = 0; s < n; s++ ) {
    if ( !left(s) || left((s + n - 1) % n) ) continue;
    let len = 0;
    while ( (len < n) && left((s + len) % n) ) len++;
    if ( len > bestLen ) {
      bestLen = len;
      bestStart = s;
    }
  }
  if ( bestStart < 0 ) return o;
  const run = Array.from({length: bestLen}, (_, k) => nodes[(bestStart + k) % n]);
  // The run's ends sit on the centre line: they are shared, not mirrored
  const inner = run.filter(p => p.x < -0.001);
  const mirrored = inner.slice().reverse().map(p => node(-p.x, p.y, p.smooth));
  const out = normalizeOutline({nodes: [...run, ...mirrored]});
  return out ?? o;
}
