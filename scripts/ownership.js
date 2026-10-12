// Who controls a particle. Foundry lets every player control a token that has no actor, so particles are linked
// (as unlinked tokens) to one shared, empty actor and carry their own ownership in their actor delta, like any NPC
// token: Foundry itself then decides who can move, change or delete each of them.

import {FLAG_PARTICLE, MODULE_ID, NO_HISTORY} from "./const.js";

export const SETTING_ACTOR = "particleActor";

/** How a particle is controlled. */
export const CONTROL_MODES = {gm: "Only the GM", players: "These players", all: "Everyone"};

/** Who controls the particles an effect makes. */
export const EFFECT_OWNERS = {caster: "Whoever controls the caster", gm: "Only the GM", all: "Everyone"};

const LEVELS = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;
const players = () => game.users.filter(u => !u.isGM);

/** An actor type of the game system to give the shared actor (an NPC where there is one). */
function actorType() {
  const types = (game.documentTypes?.Actor ?? Object.keys(CONFIG.Actor?.typeLabels ?? {})).filter(t => t !== "base");
  return types.includes("npc") ? "npc" : (types[0] ?? null);
}

let creating = null;

/** Make the shared actor (GM only), in its own folder. */
function createParticleActor() {
  creating ??= (async () => {
    try {
      const type = actorType();
      if ( !type ) return null;
      const folderName = "Kostis's Particle Effects";
      const folder = game.folders.find(f => (f.type === "Actor") && (f.name === folderName))
        ?? await Folder.implementation.create({name: folderName, type: "Actor"});
      const data = {
        name: "Particles", type, img: "icons/svg/sun.svg", folder: folder?.id ?? null,
        ownership: {default: LEVELS().NONE},
        prototypeToken: {actorLink: false},
        flags: {[MODULE_ID]: {particles: true}}
      };
      // An NPC at 0 hit points could be treated as defeated
      if ( (game.system.id === "dnd5e") && (type === "npc") ) data.system = {attributes: {hp: {value: 1, max: 1}}};
      const actor = await Actor.implementation.create(data);
      if ( actor ) await game.settings.set(MODULE_ID, SETTING_ACTOR, actor.id);
      return actor ?? null;
    } catch(err) {
      console.error(`${MODULE_ID} | could not create the particle actor`, err);
      return null;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/**
 * The world's shared particle actor (a GM creates it when it is first needed).
 * @param {object} [options]
 * @param {boolean} [options.create=true]
 * @returns {Promise<Actor|null>}
 */
export async function particleActor({create=true}={}) {
  const id = game.settings.get(MODULE_ID, SETTING_ACTOR);
  const found = id ? game.actors?.get(id) : null;
  if ( found ) return found;
  if ( !create || !game.user.isGM ) return null;
  return createParticleActor();
}

/** The shared actor's id, if it exists (no creation). */
export function particleActorId() {
  const id = game.settings.get(MODULE_ID, SETTING_ACTOR);
  return id && game.actors?.get(id) ? id : null;
}

/**
 * Ownership for a particle: "gm", "all", or the ids of the players who control it. Every player gets an explicit
 * level, so a later change can't leave an old owner behind.
 */
export function ownershipOf(spec) {
  const {NONE, OWNER} = LEVELS();
  if ( spec === "all" ) return {default: OWNER, ...Object.fromEntries(players().map(u => [u.id, OWNER]))};
  const ids = new Set(Array.isArray(spec) ? spec : []);
  return {default: NONE, ...Object.fromEntries(players().map(u => [u.id, ids.has(u.id) ? OWNER : NONE]))};
}

/** Who controls a particle token now: {mode: "gm"|"players"|"all", users: [ids]}. */
export function controlOf(doc) {
  // No actor: Foundry lets everyone control it (particles made before ownership existed)
  if ( !doc.actorId ) return {mode: "all", users: players().map(u => u.id)};
  const users = players().filter(u => doc.testUserPermission(u, "OWNER")).map(u => u.id);
  const own = doc._source?.delta?.ownership;
  if ( (own?.default ?? LEVELS().NONE) >= LEVELS().OWNER ) return {mode: "all", users};
  return {mode: users.length ? "players" : "gm", users};
}

/** The players who control a token (a caster's owners control the particles it casts). */
export function ownersOf(doc) {
  return doc ? players().filter(u => doc.testUserPermission(u, "OWNER")).map(u => u.id) : [];
}

/**
 * Token data that gives a new particle its owners.
 * @param {string|string[]} spec   "gm", "all" or player ids
 * @returns {Promise<object>}      {actorId, actorLink, delta} (empty without the shared actor: then everyone controls it)
 */
export async function controlData(spec) {
  const actor = await particleActor();
  if ( !actor ) return {};
  return {actorId: actor.id, actorLink: false, delta: {ownership: ownershipOf(spec)}};
}

/**
 * Change who controls some particles (GM). Particles without the shared actor are linked to it first.
 * @param {Scene} scene
 * @param {TokenDocument[]} docs
 * @param {string|string[]} spec
 * @returns {Promise<Function|null>}   Puts things back (for undo)
 */
export async function setControl(scene, docs, spec) {
  const actor = await particleActor();
  if ( !actor || !docs.length ) return null;
  const before = docs.map(d => ({id: d.id, actorId: d.actorId ?? null, ownership: foundry.utils.deepClone(d._source?.delta?.ownership ?? null)}));
  const link = docs.filter(d => (d.actorId !== actor.id) || d.actorLink).map(d => ({_id: d.id, actorId: actor.id, actorLink: false}));
  if ( link.length ) await scene.updateEmbeddedDocuments("Token", link, {[NO_HISTORY]: true});
  const ownership = ownershipOf(spec);
  for ( const d of docs ) {
    const doc = scene.tokens.get(d.id);
    if ( doc?.delta ) await doc.delta.update({ownership}, {[NO_HISTORY]: true});
  }
  return async () => {
    const unlink = before.filter(b => !b.actorId && scene.tokens.has(b.id)).map(b => ({_id: b.id, actorId: null}));
    if ( unlink.length ) await scene.updateEmbeddedDocuments("Token", unlink, {[NO_HISTORY]: true});
    for ( const b of before ) {
      const doc = scene.tokens.get(b.id);
      if ( b.actorId && doc?.delta ) await doc.delta.update({ownership: b.ownership ?? ownershipOf("gm")}, {[NO_HISTORY]: true});
    }
  };
}

/**
 * The shared actor was deleted: its particles would belong to the GM alone (and warn that their actor is gone).
 * Make a new one and link them to it; their own owners are kept. Active GM only.
 */
export async function repairParticleActor() {
  if ( !game.users.activeGM?.isSelf ) return;
  const id = game.settings.get(MODULE_ID, SETTING_ACTOR);
  if ( !id || game.actors.get(id) ) return;
  let actor = null;
  for ( const scene of game.scenes ) {
    const orphans = scene.tokens.filter(t => t.getFlag(MODULE_ID, FLAG_PARTICLE) && (t.actorId === id));
    if ( !orphans.length ) continue;
    actor ??= await createParticleActor();
    if ( !actor ) return;
    await scene.updateEmbeddedDocuments("Token", orphans.map(t => ({_id: t.id, actorId: actor.id})), {[NO_HISTORY]: true});
  }
}
