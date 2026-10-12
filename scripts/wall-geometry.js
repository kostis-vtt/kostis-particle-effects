// Geometry of effect walls: a measured track (one distance axis u across every piece of a path), the ribbon mesh
// an effect is painted on, projecting a token onto the track, the visible window for each reveal mode, and the
// straight segments real Foundry walls are made of. Pure functions; coordinates in scene pixels.

/**
 * @typedef {object} MeasuredPiece
 * @property {Float64Array} points   [x0, y0, ...]
 * @property {Float64Array} cum      Distance from the piece's first point
 * @property {number} start          u of the piece's first point
 * @property {number} length
 * @property {boolean} closed
 */

/**
 * Measure track pieces (from KAA.track) onto one continuous distance axis.
 * @param {{points: ArrayLike<number>, closed: boolean}[]} pieces
 * @returns {{pieces: MeasuredPiece[], length: number, closed: boolean}}
 */
export function measureTrack(pieces) {
  const out = [];
  let offset = 0;
  for ( const pc of pieces ?? [] ) {
    const pts = Float64Array.from(pc.points ?? []);
    const n = pts.length / 2;
    if ( n < 2 ) continue;
    const cum = new Float64Array(n);
    for ( let i = 1; i < n; i++ ) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[(2 * i) - 2], pts[(2 * i) + 1] - pts[(2 * i) - 1]);
    if ( !(cum[n - 1] > 0) ) continue;
    out.push({points: pts, cum, start: offset, length: cum[n - 1], closed: !!pc.closed});
    offset += cum[n - 1];
  }
  // One loop overall: a single closed piece, or pieces that chain end to start all the way round
  let closed = false;
  if ( out.length === 1 ) closed = out[0].closed;
  else if ( out.length > 1 ) {
    const end = p => [p.points[p.points.length - 2], p.points[p.points.length - 1]];
    const beg = p => [p.points[0], p.points[1]];
    closed = out.every((p, i) => {
      const [ex, ey] = end(p);
      const [bx, by] = beg(out[(i + 1) % out.length]);
      return Math.hypot(ex - bx, ey - by) < 1;
    });
  }
  return {pieces: out, length: offset, closed};
}

/** The point (and direction) at distance u along a measured track. */
export function trackPoint(track, u) {
  const L = track.length;
  if ( !(L > 0) ) return null;
  u = track.closed ? (((u % L) + L) % L) : Math.min(L, Math.max(0, u));
  let piece = track.pieces[track.pieces.length - 1];
  for ( const p of track.pieces ) {
    if ( u <= p.start + p.length ) {
      piece = p;
      break;
    }
  }
  const d = Math.min(piece.length, Math.max(0, u - piece.start));
  const cum = piece.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while ( hi - lo > 1 ) {
    const m = (lo + hi) >> 1;
    if ( cum[m] <= d ) lo = m;
    else hi = m;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (d - cum[lo]) / seg : 0;
  const P = piece.points;
  const x0 = P[2 * lo];
  const y0 = P[(2 * lo) + 1];
  const x1 = P[2 * hi];
  const y1 = P[(2 * hi) + 1];
  return {x: x0 + ((x1 - x0) * t), y: y0 + ((y1 - y0) * t), angle: Math.atan2(y1 - y0, x1 - x0)};
}

/**
 * The distance along the track of the point nearest to p.
 * @returns {{u: number, distance: number}|null}
 */
export function projectOnTrack(track, p) {
  let best = null;
  for ( const pc of track.pieces ) {
    const P = pc.points;
    const n = P.length / 2;
    for ( let i = 0; i < n - 1; i++ ) {
      const ax = P[2 * i];
      const ay = P[(2 * i) + 1];
      const dx = P[(2 * i) + 2] - ax;
      const dy = P[(2 * i) + 3] - ay;
      const L2 = (dx * dx) + (dy * dy);
      const t = L2 > 0 ? Math.min(1, Math.max(0, (((p.x - ax) * dx) + ((p.y - ay) * dy)) / L2)) : 0;
      const qx = ax + (dx * t);
      const qy = ay + (dy * t);
      const dist = Math.hypot(p.x - qx, p.y - qy);
      if ( !best || (dist < best.distance) ) best = {u: pc.start + pc.cum[i] + (Math.sqrt(L2) * t), distance: dist};
    }
  }
  return best;
}

/**
 * A triangle-strip ribbon along a piece: two vertices per point, mitred at corners.
 * @param {MeasuredPiece} piece
 * @param {number} halfWidth      Pixels either side of the line
 * @returns {{positions: Float32Array, uvs: Float32Array, indices: Uint16Array|Uint32Array}}
 */
export function ribbon(piece, halfWidth) {
  const P = piece.points;
  const n = P.length / 2;
  const positions = new Float32Array(n * 4);
  const uvs = new Float32Array(n * 4);
  const dirOf = (i, j) => {
    const dx = P[2 * j] - P[2 * i];
    const dy = P[(2 * j) + 1] - P[(2 * i) + 1];
    const L = Math.hypot(dx, dy);
    return L > 1e-9 ? [dx / L, dy / L] : null;
  };
  let lastDir = dirOf(0, 1) ?? [1, 0];
  // The last vertex placed on each side: near a sharp corner the inner side would fold back over itself, so a
  // vertex that would step backwards along the path stays where the previous one was (a clean fan join)
  const last = [null, null];
  for ( let i = 0; i < n; i++ ) {
    // Directions of the segments either side (loops wrap round their seam)
    let before = i > 0 ? dirOf(i - 1, i) : (piece.closed ? dirOf(n - 2, n - 1) : null);
    let after = i < n - 1 ? dirOf(i, i + 1) : (piece.closed ? dirOf(0, 1) : null);
    before ??= after ?? lastDir;
    after ??= before;
    lastDir = after;
    const n1x = -before[1];
    const n1y = before[0];
    const n2x = -after[1];
    const n2y = after[0];
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    let scale = 1;
    if ( ml < 1e-6 ) {
      mx = n1x;
      my = n1y;
    } else {
      mx /= ml;
      my /= ml;
      // Sharp corners: the outer edge goes out at most twice the width (longer spikes look like glitches)
      scale = 1 / Math.max(0.5, (mx * n1x) + (my * n1y));
    }
    const x = P[2 * i];
    const y = P[(2 * i) + 1];
    const w = halfWidth * scale;
    const sides = [[x + (mx * w), y + (my * w)], [x - (mx * w), y - (my * w)]];
    const travel = before;
    for ( let k = 0; k < 2; k++ ) {
      const prev = last[k];
      if ( prev && ((((sides[k][0] - prev[0]) * travel[0]) + ((sides[k][1] - prev[1]) * travel[1])) < 0) ) sides[k] = prev;
      last[k] = sides[k];
    }
    positions.set([sides[0][0], sides[0][1], sides[1][0], sides[1][1]], i * 4);
    const u = piece.start + piece.cum[i];
    uvs.set([u, 1, u, -1], i * 4);
  }
  const Index = (n * 2) > 65535 ? Uint32Array : Uint16Array;
  const indices = new Index((n - 1) * 6);
  for ( let i = 0; i < n - 1; i++ ) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return {positions, uvs, indices};
}

/**
 * The visible part of a wall right now.
 * @param {object} reveal       A normalized reveal ({mode, direction, duration, then, hold, fade, length, speed})
 * @param {object} ctx
 * @param {number} ctx.length   Track length (px)
 * @param {boolean} ctx.closed
 * @param {number} ctx.grid     Grid size (px)
 * @param {number} ctx.elapsed  Seconds since the reveal started
 * @param {number|null} [ctx.head]     Follow mode: where the token is along the track (px)
 * @param {number|null} [ctx.cycles]   Follow mode: laps the token has completed
 * @returns {{a: number, span: number, alpha: number, taper: number, front: number, back: boolean}}
 *   a = where the window starts (px), span = its length; taper fades it towards its tail (0..1); front lights the
 *   leading edge (0..1); back = it moves towards the path's start (its head is at `a`)
 */
export function revealWindow(reveal, {length, closed, grid, elapsed=0, head=null, cycles=null}) {
  const L = Math.max(0, length);
  const full = {a: 0, span: L, alpha: 1, taper: 0, front: 0};
  if ( !(L > 0) ) return {a: 0, span: 0, alpha: 0, taper: 0, front: 0};
  const t = Math.max(0, elapsed);
  let win = full;
  switch ( reveal.mode ) {
    case "grow": {
      const D = Math.max(0.05, reveal.duration);
      if ( reveal.then === "loop" ) {
        const cycle = D + reveal.hold;
        const p = Math.min(1, (t % cycle) / D);
        win = {a: 0, span: p * L, alpha: 1, taper: 0, front: p < 1 ? 1 : 0};
      } else {
        const p = Math.min(1, t / D);
        let alpha = 1;
        if ( (reveal.then === "fade") && (t > D + reveal.hold) ) alpha = Math.max(0, 1 - ((t - D - reveal.hold) / Math.max(0.05, reveal.fade)));
        win = {a: 0, span: p * L, alpha, taper: 0, front: p < 1 ? 1 : 0};
      }
      break;
    }
    case "train": {
      const len = Math.min(L, Math.max(1, reveal.length * grid));
      const travelled = t * reveal.speed * grid;
      if ( closed ) win = {a: travelled - len, span: len, alpha: 1, taper: 0.65, front: 1};
      else if ( reveal.then === "loop" ) {
        const h = travelled % (L + len);
        win = {a: h - len, span: len, alpha: 1, taper: 0.65, front: 1};
      } else if ( reveal.then === "stay" ) {
        const h = Math.min(L, travelled);
        win = {a: h - len, span: len, alpha: 1, taper: 0.65, front: h < L ? 1 : 0};
      } else win = {a: travelled - len, span: len, alpha: travelled - len > L ? 0 : 1, taper: 0.65, front: 1};
      break;
    }
    case "follow": {
      if ( head === null ) return {a: 0, span: 0, alpha: 0, taper: 0, front: 0};
      const trail = Math.max(0, reveal.length * grid);
      if ( trail > 0 ) win = {a: head - Math.min(L, trail), span: Math.min(L, trail), alpha: 1, taper: 0.65, front: 1};
      else if ( cycles >= 1 ) win = full;
      else win = {a: 0, span: Math.max(0, head), alpha: 1, taper: 0, front: 1};
      break;
    }
  }
  if ( (reveal.direction === "backward") && (reveal.mode !== "follow") ) {
    // Mirror the window onto the reversed axis: its head is now at its start
    win = {...win, a: L - (win.a + win.span), back: true};
  }
  win = {...win, back: !!win.back};
  if ( closed && (win.span < L) ) win.a = ((win.a % L) + L) % L;
  return win;
}

/** Ramer–Douglas–Peucker on a flat point array. */
function simplifyFlat(P, epsilon) {
  const n = P.length / 2;
  if ( n < 3 ) return Array.from({length: n}, (_, i) => [P[2 * i], P[(2 * i) + 1]]);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    const ax = P[2 * a];
    const ay = P[(2 * a) + 1];
    const dx = P[2 * b] - ax;
    const dy = P[(2 * b) + 1] - ay;
    const L2 = (dx * dx) + (dy * dy);
    let best = -1;
    let bd = epsilon;
    for ( let i = a + 1; i < b; i++ ) {
      const px = P[2 * i] - ax;
      const py = P[(2 * i) + 1] - ay;
      const t = L2 > 0 ? Math.min(1, Math.max(0, ((px * dx) + (py * dy)) / L2)) : 0;
      const d = Math.hypot(px - (dx * t), py - (dy * t));
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
  const out = [];
  for ( let i = 0; i < n; i++ ) if ( keep[i] ) out.push([P[2 * i], P[(2 * i) + 1]]);
  return out;
}

/**
 * Straight segments that follow a track closely (for real Foundry walls).
 * @param {object} track       A measured track
 * @param {number} tolerance   Allowed deviation (px)
 * @returns {number[][]}       [x0, y0, x1, y1] each, rounded to whole pixels
 */
export function wallSegments(track, tolerance) {
  const out = [];
  for ( const pc of track.pieces ) {
    let pts;
    if ( pc.closed && (pc.points.length >= 8) ) {
      // Split a loop at its far point so both halves keep their corners
      const P = pc.points;
      const n = P.length / 2;
      let far = 0;
      let fd = -1;
      for ( let i = 1; i < n; i++ ) {
        const d = Math.hypot(P[2 * i] - P[0], P[(2 * i) + 1] - P[1]);
        if ( d > fd ) {
          fd = d;
          far = i;
        }
      }
      pts = [...simplifyFlat(P.slice(0, (2 * far) + 2), tolerance), ...simplifyFlat(P.slice(2 * far), tolerance).slice(1)];
    } else pts = simplifyFlat(pc.points, tolerance);
    for ( let i = 1; i < pts.length; i++ ) {
      const c = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]].map(v => Math.round(v));
      if ( (c[0] !== c[2]) || (c[1] !== c[3]) ) out.push(c);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Layers                                      */
/* -------------------------------------------- */

/** Every point of a track in order, as one flat list. */
function allPoints(track) {
  const out = [];
  for ( const pc of track.pieces ) for ( let i = 0; i < pc.points.length; i++ ) out.push(pc.points[i]);
  return out;
}

/** Signed area inside a track's points (positive when it runs clockwise on screen, where y points down). */
export function trackArea(track) {
  const P = allPoints(track);
  const n = P.length / 2;
  let a = 0;
  for ( let i = 0; i < n; i++ ) {
    const j = (i + 1) % n;
    a += (P[2 * i] * P[(2 * j) + 1]) - (P[2 * j] * P[(2 * i) + 1]);
  }
  return a / 2;
}

/** The middle of the area a track encloses (the middle of its points when it encloses none). */
export function trackCentroid(track) {
  const P = allPoints(track);
  const n = P.length / 2;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for ( let i = 0; i < n; i++ ) {
    const j = (i + 1) % n;
    const cross = (P[2 * i] * P[(2 * j) + 1]) - (P[2 * j] * P[(2 * i) + 1]);
    a += cross;
    cx += (P[2 * i] + P[2 * j]) * cross;
    cy += (P[(2 * i) + 1] + P[(2 * j) + 1]) * cross;
  }
  if ( Math.abs(a) > 1e-6 ) return {x: cx / (3 * a), y: cy / (3 * a)};
  let sx = 0;
  let sy = 0;
  for ( let i = 0; i < n; i++ ) {
    sx += P[2 * i];
    sy += P[(2 * i) + 1];
  }
  return {x: sx / Math.max(1, n), y: sy / Math.max(1, n)};
}

/** Where two segments cross (ends included), or null (parallel ones never do). */
function crossing(ax, ay, bx, by, cx, cy, ex, ey) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = ex - cx;
  const sy = ey - cy;
  const den = (rx * sy) - (ry * sx);
  if ( Math.abs(den) < 1e-9 ) return null;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = ((qx * sy) - (qy * sx)) / den;
  const u = ((qx * ry) - (qy * rx)) / den;
  const e = 1e-9;
  if ( (t < -e) || (t > 1 + e) || (u < -e) || (u > 1 + e) ) return null;
  return {x: ax + (rx * t), y: ay + (ry * t)};
}

/**
 * A piece's points moved d pixels to the right of travel (mitred like the ribbon). Inside a corner such a line would
 * fold back and loop over itself; those points are moved onto the corner instead, so the line keeps one point for
 * each of the path's (its distances, and so its reveal and patterns, stay in step with the path).
 */
function offsetPoints(piece, d) {
  const P = piece.points;
  const n = P.length / 2;
  const closed = piece.closed && (n > 3);
  // Distinct points: a loop's last point is its first
  const m = closed ? n - 1 : n;
  const at = k => ((k % m) + m) % m;
  const dirOf = (i, j) => {
    const dx = P[2 * j] - P[2 * i];
    const dy = P[(2 * j) + 1] - P[(2 * i) + 1];
    const L = Math.hypot(dx, dy);
    return L > 1e-9 ? [dx / L, dy / L] : null;
  };
  // Each point's mitred offset
  const qx = new Float64Array(m);
  const qy = new Float64Array(m);
  const turn = new Float64Array(m);
  let lastDir = dirOf(0, 1) ?? [1, 0];
  for ( let i = 0; i < m; i++ ) {
    let before = i > 0 ? dirOf(i - 1, i) : (closed ? dirOf(m - 1, 0) : null);
    let after = i < m - 1 ? dirOf(i, i + 1) : (closed ? dirOf(m - 1, 0) : null);
    before ??= after ?? lastDir;
    after ??= before;
    lastDir = after;
    turn[i] = Math.abs(Math.atan2((before[0] * after[1]) - (before[1] * after[0]), (before[0] * after[0]) + (before[1] * after[1])));
    let mx = -before[1] - after[1];
    let my = before[0] + after[0];
    const ml = Math.hypot(mx, my);
    let scale = 1;
    if ( ml < 1e-6 ) {
      mx = -before[1];
      my = before[0];
    } else {
      mx /= ml;
      my /= ml;
      scale = 1 / Math.max(0.5, (mx * -before[1]) + (my * before[0]));
    }
    qx[i] = P[2 * i] + (mx * d * scale);
    qy[i] = P[(2 * i) + 1] + (my * d * scale);
  }
  // A loop is tidied from the middle of its longest straight stretch, so no corner straddles its seam
  let first = 0;
  if ( closed ) {
    let best = -1;
    for ( let s = 0; s < m; s++ ) {
      if ( (turn[s] > 0.15) || (turn[at(s - 1)] <= 0.15) ) continue;
      let len = 0;
      while ( (len < m) && (turn[at(s + len)] <= 0.15) ) len++;
      if ( len > best ) {
        best = len;
        first = at(s + Math.floor(len / 2));
      }
    }
  }
  const count = closed ? m + 1 : m;
  const order = Array.from({length: count}, (_, k) => at(first + k));
  const ox = Float64Array.from(order, i => qx[i]);
  const oy = Float64Array.from(order, i => qy[i]);
  const dist = new Float64Array(count);
  for ( let k = 1; k < count; k++ ) {
    dist[k] = dist[k - 1] + Math.hypot(P[2 * order[k]] - P[2 * order[k - 1]], P[(2 * order[k]) + 1] - P[(2 * order[k - 1]) + 1]);
  }
  // 1. Cut out the loops it makes where it runs past a corner and crosses itself: all their points go to the crossing
  // (first, while the loops still cross: held back, they would only run back and forth over themselves)
  const reach = (4 * Math.abs(d)) + 1;
  for ( let i = 0; i < count - 3; i++ ) {
    const ax = ox[i];
    const ay = oy[i];
    const bx = ox[i + 1];
    const by = oy[i + 1];
    if ( (ax === bx) && (ay === by) ) continue;
    let last = i + 2;
    while ( (last + 2 < count) && (last + 1 <= i + Math.floor(count / 2)) && (dist[last + 1] - dist[i] <= reach) ) last++;
    for ( let j = last; j >= i + 2; j-- ) {
      const hit = crossing(ax, ay, bx, by, ox[j], oy[j], ox[j + 1], oy[j + 1]);
      if ( !hit ) continue;
      for ( let k = i + 1; k <= j; k++ ) {
        ox[k] = hit.x;
        oy[k] = hit.y;
      }
      i = j - 1;
      break;
    }
  }
  // 2. Never step back along the path (what is left of a fold waits at the corner for the path to come round)
  let dir = [1, 0];
  for ( let k = 1; k < count; k++ ) {
    dir = dirOf(order[k - 1], order[k]) ?? dir;
    if ( (((ox[k] - ox[k - 1]) * dir[0]) + ((oy[k] - oy[k - 1]) * dir[1])) < 0 ) {
      ox[k] = ox[k - 1];
      oy[k] = oy[k - 1];
    }
  }
  const out = new Float64Array(P.length);
  for ( let k = 0; k < m; k++ ) {
    out[2 * order[k]] = ox[k];
    out[(2 * order[k]) + 1] = oy[k];
  }
  if ( closed ) {
    out[2 * (n - 1)] = out[0];
    out[(2 * (n - 1)) + 1] = out[1];
  }
  return out;
}

/**
 * A track running beside another, d pixels away: on a loop + is outside and − inside; on an open path + is its
 * right. It keeps the original's distances, so reveals and patterns stay in step with it.
 */
export function offsetTrack(track, d) {
  if ( !d ) return track;
  const sign = track.closed ? (trackArea(track) > 0 ? -1 : 1) : 1;
  return {pieces: track.pieces.map(pc => ({...pc, points: offsetPoints(pc, d * sign)})), length: track.length, closed: track.closed};
}

/** How far a ray from p in direction (dx, dy) goes before it first meets the track (null if it never does). */
function rayExit(track, p, dx, dy) {
  let best = null;
  for ( const pc of track.pieces ) {
    const P = pc.points;
    for ( let i = 0; i < (P.length / 2) - 1; i++ ) {
      const ax = P[2 * i] - p.x;
      const ay = P[(2 * i) + 1] - p.y;
      const ex = P[(2 * i) + 2] - P[2 * i];
      const ey = P[(2 * i) + 3] - P[(2 * i) + 1];
      const den = (dx * ey) - (dy * ex);
      if ( Math.abs(den) < 1e-12 ) continue;
      const t = ((ax * ey) - (ay * ex)) / den;
      const s = ((ax * dy) - (ay * dx)) / den;
      if ( (t > 1e-6) && (s >= 0) && (s <= 1) && ((best === null) || (t < best)) ) best = t;
    }
  }
  return best;
}

/**
 * The straight lines of a star across a loop: `points` points round its middle (the first straight up, turned by
 * `turn` degrees), each where that direction meets the loop, drawn in towards the middle by `inset` (0..1); each
 * point is joined to the one `step` further round. None on an open path.
 * @returns {object[]}   One measured track per line
 */
export function starChords(track, {points, step, inset=0, turn=0}) {
  if ( !track.closed || !(track.length > 0) || !(points >= 3) ) return [];
  const c = trackCentroid(track);
  const k = 1 - Math.min(0.95, Math.max(0, inset));
  const pts = Array.from({length: points}, (_, i) => {
    const a = (-Math.PI / 2) + ((turn * Math.PI) / 180) + ((Math.PI * 2 * i) / points);
    const t = rayExit(track, c, Math.cos(a), Math.sin(a));
    // (A loop that doesn't surround its own middle: spread the points along it instead)
    const p = t === null ? trackPoint(track, (track.length * i) / points) : {x: c.x + (Math.cos(a) * t), y: c.y + (Math.sin(a) * t)};
    return {x: c.x + ((p.x - c.x) * k), y: c.y + ((p.y - c.y) * k)};
  });
  const out = [];
  for ( let i = 0; i < points; i++ ) {
    // Joining every (points / 2)-th point, each line would be drawn twice
    if ( (2 * step === points) && (i >= points / 2) ) continue;
    const a = pts[i];
    const b = pts[(i + step) % points];
    if ( Math.hypot(b.x - a.x, b.y - a.y) < 1 ) continue;
    out.push(measureTrack([{points: [a.x, a.y, b.x, b.y], closed: false}]));
  }
  return out;
}
