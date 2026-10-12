export const MODULE_ID = "kostis-particle-effects";
export const MODULE_TITLE = "Kostis's Particle Effects";
export const HUB_ID = "kostis-flying-paths";
export const ANIMATOR_ID = "kostis-actual-animator";
export const SOCKET = `module.${MODULE_ID}`;

/** Token flag: this token is a particle ({preset, variant}). */
export const FLAG_PARTICLE = "particle";

/** Token flag: this token was spawned by a cast and goes away on its own ({cast, lifetime, until, impact}). */
export const FLAG_SPAWN = "spawn";

/** Token flag: auras drawn around the token ({[id]: {preset, scale, below, alpha, spin}}). */
export const FLAG_AURAS = "auras";

/** Token and scene flag: particle emitters ({[id]: {emitter, x?, y?}}). */
export const FLAG_EMITTERS = "emitters";

/** Scene flag: effect walls ({[id]: wall}). */
export const FLAG_WALLS = "walls";

/** Scene flag: animator animations made for casts ({[castId]: animId}), deleted when the cast is over. */
export const FLAG_CASTS = "casts";

/** Delete a key in a document update (v14 ForcedDeletion operator). */
export const DEL = () => globalThis._del ?? new foundry.data.operators.ForcedDeletion();

/** The hub's history guard option. */
export const NO_HISTORY = "kfpNoHistory";
