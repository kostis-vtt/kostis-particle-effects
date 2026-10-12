// What the GM accepts from players through the relay. Players only reach the scene they are viewing, and their
// requests are trimmed to what the module itself would send (a player could send anything).

import {FLAG_EMITTERS, FLAG_PARTICLE, HUB_ID, MODULE_ID} from "./const.js";
import {ownershipOf, particleActorId} from "./ownership.js";

/** Most particles one request may make. */
export const RELAY_LIMIT = 48;

const finite = (v, d=0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const id = v => ((typeof v === "string") && /^[A-Za-z0-9]{1,32}$/.test(v) ? v : null);
const point = p => (p && (typeof p === "object") ? {x: finite(p.x), y: finite(p.y)} : null);

/** The scene a request is for (players: only the one they are viewing). */
export function playerScene(sceneId, user) {
  const scene = game.scenes.get(sceneId);
  if ( !scene ) throw new Error("Scene not found");
  if ( !user?.isGM && (user?.viewedScene !== scene.id) ) throw new Error("Only on the scene you are viewing");
  return scene;
}

/** Emitters to attach: {[key]: {emitter: id}} only. */
function emittersOf(raw) {
  if ( !raw || (typeof raw !== "object") ) return undefined;
  const out = {};
  for ( const [k, e] of Object.entries(raw).slice(0, 4) ) {
    if ( id(k) && (typeof e?.emitter === "string") ) out[k] = {emitter: e.emitter.slice(0, 64)};
  }
  return Object.keys(out).length ? out : undefined;
}

/** A spawn request: placed particles (casts go through playerCast). */
export function playerSpawn(payload, user) {
  if ( user?.isGM ) return payload;
  const p = payload ?? {};
  return {
    preset: p.preset,
    sceneId: p.sceneId,
    centers: (Array.isArray(p.centers) ? p.centers : []).slice(0, RELAY_LIMIT).map(point).filter(Boolean),
    size: p.size == null ? undefined : Math.clamp(finite(p.size, 1), 0.1, 100),
    elevation: finite(p.elevation),
    disposition: [-2, -1, 0, 1].includes(p.disposition) ? p.disposition : undefined,
    emitters: emittersOf(p.emitters),
    name: typeof p.name === "string" ? p.name.slice(0, 80) : undefined
  };
}

/** A cast request. */
export function playerCast(payload, user) {
  if ( user?.isGM ) return payload;
  const p = payload ?? {};
  return {
    effect: p.effect,
    sceneId: p.sceneId,
    casterId: id(p.casterId),
    targetIds: (Array.isArray(p.targetIds) ? p.targetIds : []).map(id).filter(Boolean).slice(0, 24),
    point: point(p.point)
  };
}

/**
 * Particles to bring back (undoing a removal): only particles the player made, with images the module made, never
 * linked to an actor and never with vision.
 */
export function playerRestore(scene, data, user) {
  const list = (Array.isArray(data) ? data : []).filter(d => d && id(d._id) && !scene.tokens.has(d._id));
  if ( user?.isGM ) return list;
  const dir = `${game.modules.get(HUB_ID)?.api?.storage?.dir("particles") ?? ""}/`;
  return list.slice(0, RELAY_LIMIT).filter(d => {
    const p = d.flags?.[MODULE_ID]?.[FLAG_PARTICLE];
    return p && (p.by === user.id) && String(d.texture?.src ?? "").startsWith(dir);
  }).map(d => {
    const flags = {...d.flags, [MODULE_ID]: {...d.flags[MODULE_ID], [FLAG_EMITTERS]: emittersOf(d.flags[MODULE_ID][FLAG_EMITTERS])}};
    if ( !flags[MODULE_ID][FLAG_EMITTERS] ) delete flags[MODULE_ID][FLAG_EMITTERS];
    // Back on the shared particle actor (when it exists), controlled by the player alone
    const actorId = particleActorId();
    const control = actorId ? {actorId, actorLink: false, delta: {ownership: ownershipOf([user.id])}} : {actorId: null, actorLink: false, delta: null};
    return {...d, flags, ...control, sight: {enabled: false}, detectionModes: []};
  });
}
