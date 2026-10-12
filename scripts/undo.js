// Undo steps for this module, recorded in the Kostis's Flying Paths history (Ctrl+Z).

import {DEL, HUB_ID, MODULE_ID, NO_HISTORY} from "./const.js";

const REPLACE = v => (globalThis._replace ? globalThis._replace(v) : foundry.data.operators.ForcedReplacement.create(v));

/** Record an undoable step for a scene. */
export function remember(label, undo, scene=canvas.scene) {
  game.modules.get(HUB_ID)?.api?.history?.push(label, undo, {sceneId: scene?.id ?? null, module: MODULE_ID});
}

/**
 * How tokens are now (some fields plus this module's flags), to put back on undo.
 * @param {TokenDocument[]} docs
 * @param {string[]} [fields]   Dotted paths, e.g. ["texture.src", "light", "hidden"]
 */
export function snapshot(docs, fields=[]) {
  // Read the stored data: fields like `light` are live DataModels on the document (deepClone would hand back the same
  // object, which later edits change in place, so undo would restore the new values)
  return docs.map(d => {
    const src = d._source ?? d;
    return {
      id: d.id,
      flags: foundry.utils.deepClone(src.flags?.[MODULE_ID] ?? null),
      fields: Object.fromEntries(fields.map(f => [f, foundry.utils.deepClone(foundry.utils.getProperty(src, f))]))
    };
  });
}

/** Put tokens back as a snapshot recorded them (tokens deleted since are skipped). */
export async function restore(scene, snaps) {
  const updates = snaps.filter(s => scene.tokens.has(s.id)).map(s => ({
    _id: s.id, ...s.fields, flags: {[MODULE_ID]: s.flags ? REPLACE(s.flags) : DEL()}
  }));
  if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, {[NO_HISTORY]: true});
}

/** Full copies of tokens, to recreate them on undo. */
export function copies(docs) {
  return docs.map(d => d.toObject());
}

/** Recreate deleted particles with their ids (players without the permission go through the GM). */
export async function recreate(scene, data) {
  const missing = data.filter(d => !scene.tokens.has(d._id));
  if ( !missing.length ) return;
  if ( game.user.isGM || game.user.can("TOKEN_CREATE") ) {
    await scene.createEmbeddedDocuments("Token", missing, {[NO_HISTORY]: true, keepId: true});
  } else await game.modules.get(HUB_ID).api.relay.call(`${MODULE_ID}.restore`, {sceneId: scene.id, data: missing});
}

/** Remove particles (players without the permission go through the GM). */
export async function removeTokens(scene, ids) {
  const live = ids.filter(id => scene.tokens.has(id));
  if ( !live.length ) return;
  if ( game.user.isGM || game.user.can("TOKEN_DELETE") ) {
    await scene.deleteEmbeddedDocuments("Token", live, {[NO_HISTORY]: true, [MODULE_ID]: {despawn: true}});
  } else await game.modules.get(HUB_ID).api.relay.call(`${MODULE_ID}.despawn`, {ids: live, sceneId: scene.id});
}

export {REPLACE};
