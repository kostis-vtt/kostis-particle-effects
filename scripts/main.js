// Kostis's Particle Effects — entry point. Part of the Kostis's Flying Paths family (requires the hub module).

import {ANIMATOR_ID, DEL, FLAG_AURAS, FLAG_EMITTERS, FLAG_PARTICLE, FLAG_SPAWN, FLAG_WALLS, HUB_ID, MODULE_ID, NO_HISTORY, SOCKET} from "./const.js";
import {Library} from "./library.js";
import {ParticleTokens} from "./tokens.js";
import {Auras, normalizeAura} from "./auras.js";
import {Emitters} from "./emitters.js";
import {Caster, Janitor} from "./caster.js";
import {LiveTextures, bake, clearTextureCaches} from "./textures.js";
import {ParticleStudio} from "./studio.js";
import {registerTools} from "./tools.js";
import {State} from "./state.js";
import {KINDS} from "./shader.js";
import {ParticleManager} from "./manager.js";
import {EffectWallBlocks, EffectWalls} from "./effect-walls.js";
import {Walls} from "./walls-api.js";
import {WallManager} from "./wall-manager.js";
import {REPLACE, copies, recreate, remember, removeTokens, restore, snapshot} from "./undo.js";
import {playerCast, playerRestore, playerScene, playerSpawn} from "./relay-checks.js";
import {SETTING_ACTOR, repairParticleActor} from "./ownership.js";

/** Resolve token references (tokens, documents, ids) on the viewed scene. */
function docsOf(tokens) {
  const list = Array.isArray(tokens) || (tokens instanceof Set) ? [...tokens] : [tokens];
  return list.map(t => {
    if ( typeof t === "string" ) return canvas.scene?.tokens.get(t);
    return t?.document ?? t;
  }).filter(d => d?.documentName === "Token");
}

const L = (key, data) => (data ? game.i18n.format(`KPE.Undo.${key}`, data) : game.i18n.localize(`KPE.Undo.${key}`));

/** Change tokens' flags (only those this user may change), recording an undo step. */
async function changeTokens(docs, changesFor, label) {
  const allowed = docs.filter(d => d.canUserModify(game.user, "update"));
  if ( allowed.length < docs.length ) ui.notifications.warn("KPE.Warn.CannotModify", {localize: true});
  if ( !allowed.length ) return;
  const byScene = new Map();
  for ( const d of allowed ) byScene.set(d.parent, [...(byScene.get(d.parent) ?? []), d]);
  for ( const [scene, list] of byScene ) {
    const before = snapshot(list);
    await scene.updateEmbeddedDocuments("Token", list.map(d => ({_id: d.id, ...changesFor(d)})), {[NO_HISTORY]: true});
    remember(label, () => restore(scene, before), scene);
  }
}

const api = {
  KINDS,
  library: Library,
  particles: () => Library.all("particles"),
  emitters: () => Library.all("emitters"),
  effects: () => Library.all("effects"),
  openStudio: options => ParticleStudio.open(options),
  /** The manager for every particle on the scene (optionally focused on some tokens). */
  openManager: options => ParticleManager.open(options),
  /** The manager for every effect wall on the scene. */
  openWalls: options => WallManager.open(options),
  /**
   * Effect walls: looks painted along animator paths.
   * @example KPE.walls.draw("Wall of fire", {tool: "freehand"})
   * @example KPE.walls.attach("Fire trail", animationId)
   */
  walls: Walls,

  /**
   * Spawn particle tokens at one or more points.
   * @param {string|object} preset          Particle id, name or data
   * @param {{x,y}|{x,y}[]} points
   * @param {object} [options]              size, elevation, disposition, emitters, name
   * @example KPE.spawn("Fireball", {x: 1200, y: 800})
   */
  spawn: async (preset, points, options={}) => {
    const scene = options.sceneId ? game.scenes.get(options.sceneId) : canvas.scene;
    const ids = await ParticleTokens.spawn(preset, {...options, centers: Array.isArray(points) ? points : [points]});
    if ( ids?.length ) remember(L("Place", {count: ids.length}), () => ParticleTokens.despawn(ids, {sceneId: scene?.id}), scene);
    return ids;
  },

  /** Remove particle tokens (every particle on the viewed scene when no tokens are given). */
  despawn: async tokens => {
    const scene = canvas.scene;
    const docs = tokens ? docsOf(tokens) : scene?.tokens.filter(t => t.getFlag(MODULE_ID, FLAG_PARTICLE)) ?? [];
    const saved = copies(docs.filter(d => d.getFlag(MODULE_ID, FLAG_PARTICLE)));
    const n = await ParticleTokens.despawn(docs.map(d => d.id));
    if ( n && saved.length ) remember(L("Remove", {count: saved.length}), () => recreate(scene, saved), scene);
    return n;
  },

  /**
   * Cast an effect from a token at the current targets.
   * @example KPE.cast("Magic missile")   // from the selected token at your targets
   */
  cast: async (effect, options) => {
    const scene = canvas.scene;
    const res = await Caster.cast(effect, options);
    if ( res?.tokens?.length ) {
      const name = Library.get("effects", effect)?.name ?? "";
      remember(L("Cast", {name}), () => ParticleTokens.despawn(res.tokens, {sceneId: scene.id}), scene);
    }
    return res;
  },

  /** Draw a particle look around tokens. Returns the aura id. */
  attachAura: async (tokens, preset, {scale=1, below=true, alpha=1, spin=0, id}={}) => {
    const p = Library.get("particles", preset);
    if ( !p ) return null;
    const key = id ?? foundry.utils.randomID(8);
    await changeTokens(docsOf(tokens), () => ({flags: {[MODULE_ID]: {[FLAG_AURAS]: {[key]: {preset: p, scale, below, alpha, spin}}}}}),
      L("AddAura", {name: p.name}));
    return key;
  },
  removeAuras: (tokens, id) => changeTokens(docsOf(tokens),
    () => ({flags: {[MODULE_ID]: id ? {[FLAG_AURAS]: {[id]: DEL()}} : {[FLAG_AURAS]: DEL()}}}), L("RemoveAuras")),

  /** Attach an emitter to tokens (it follows them, animator motion included). Returns the emitter id. */
  addEmitter: async (tokens, emitter, {id}={}) => {
    const e = Library.get("emitters", emitter);
    if ( !e ) return null;
    const key = id ?? foundry.utils.randomID(8);
    await changeTokens(docsOf(tokens), () => ({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: {[key]: {emitter: e}}}}}), L("AddEmitter", {name: e.name}));
    return key;
  },
  removeEmitters: (tokens, id) => changeTokens(docsOf(tokens),
    () => ({flags: {[MODULE_ID]: id ? {[FLAG_EMITTERS]: {[id]: DEL()}} : {[FLAG_EMITTERS]: DEL()}}}), L("RemoveEmitters")),

  /** A fixed emitter on the scene (GM). */
  placeEmitter: async (point, emitter, {elevation=0, scene}={}) => {
    scene ??= canvas.scene;
    const e = Library.get("emitters", emitter);
    if ( !e || !scene ) return null;
    const id = foundry.utils.randomID(8);
    await scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: {[id]: {emitter: e, x: point.x, y: point.y, elevation}}}}});
    remember(L("PlaceEmitter", {name: e.name}), () => scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: {[id]: DEL()}}}}), scene);
    return id;
  },
  removeSceneEmitter: async (id, {scene}={}) => {
    scene ??= canvas.scene;
    const saved = foundry.utils.deepClone(scene?.getFlag(MODULE_ID, FLAG_EMITTERS)?.[id]);
    if ( !saved ) return;
    await scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: {[id]: DEL()}}}});
    remember(L("RemoveEmitter"), () => scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: {[id]: saved}}}}), scene);
  },

  /** Play a one-off burst at a point for everyone. */
  burst: (emitter, point, options) => Emitters.burst(emitter, point, options),

  /** Remove every particle, aura and emitter this module put on a scene. */
  clearScene: async ({scene, confirm=false}={}) => {
    scene ??= canvas.scene;
    if ( !scene ) return;
    if ( confirm ) {
      const ok = await foundry.applications.api.DialogV2.confirm({window: {title: "Clear particle effects"},
        content: "<p>Remove every particle token, aura and emitter from this scene?</p>"});
      if ( !ok ) return;
    }
    const particles = scene.tokens.filter(t => t.getFlag(MODULE_ID, FLAG_PARTICLE));
    const decorated = scene.tokens.filter(t => !t.getFlag(MODULE_ID, FLAG_PARTICLE) && (t.getFlag(MODULE_ID, FLAG_AURAS) || t.getFlag(MODULE_ID, FLAG_EMITTERS)));
    const savedParticles = copies(particles);
    const savedDecor = snapshot(decorated);
    const savedEmitters = foundry.utils.deepClone(scene.getFlag(MODULE_ID, FLAG_EMITTERS) ?? null);
    if ( particles.length ) await removeTokens(scene, particles.map(t => t.id));
    if ( decorated.length ) {
      await scene.updateEmbeddedDocuments("Token", decorated.map(t => ({_id: t.id, flags: {[MODULE_ID]: {[FLAG_AURAS]: DEL(), [FLAG_EMITTERS]: DEL()}}})),
        {[NO_HISTORY]: true});
    }
    if ( savedEmitters ) await scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: DEL()}}});
    if ( particles.length || decorated.length || savedEmitters ) {
      remember(L("Clear"), async () => {
        await recreate(scene, savedParticles);
        await restore(scene, savedDecor);
        if ( savedEmitters ) await scene.update({flags: {[MODULE_ID]: {[FLAG_EMITTERS]: REPLACE(savedEmitters)}}});
      }, scene);
    }
  },

  /** Make sure a look exists as an image file; returns its path. */
  bake: preset => bake(Library.get("particles", preset)),
  state: State
};

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = api;
  globalThis.KPE = api;

  game.settings.register(MODULE_ID, "library", {scope: "world", config: false, type: Object, default: {}});
  // The shared actor particle tokens are linked to, so each can have its own owners
  game.settings.register(MODULE_ID, SETTING_ACTOR, {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "playersCanCast", {
    name: "KPE.Settings.PlayersCanCast.Name", hint: "KPE.Settings.PlayersCanCast.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render({reset: true})
  });
  game.settings.register(MODULE_ID, "animate", {
    name: "KPE.Settings.Animate.Name", hint: "KPE.Settings.Animate.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => ParticleTokens.applyAll()
  });
  game.settings.register(MODULE_ID, "fps", {
    name: "KPE.Settings.Fps.Name", hint: "KPE.Settings.Fps.Hint",
    scope: "client", config: true, type: Number, default: 30,
    range: {min: 5, max: 60, step: 5},
    onChange: v => { LiveTextures.fps = v; }
  });
  game.settings.register(MODULE_ID, "quality", {
    name: "KPE.Settings.Quality.Name", hint: "KPE.Settings.Quality.Hint",
    scope: "client", config: true, type: Number, default: 1,
    choices: {0.5: "KPE.Settings.Quality.Low", 1: "KPE.Settings.Quality.Normal", 1.5: "KPE.Settings.Quality.High"},
    onChange: v => { LiveTextures.quality = Number(v) || 1; }
  });
  game.settings.register(MODULE_ID, "emitters", {
    name: "KPE.Settings.Emitters.Name", hint: "KPE.Settings.Emitters.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => {
      Emitters.sync();
      EffectWalls.sync();
    }
  });
  game.keybindings.register(MODULE_ID, "openStudio", {
    name: "KPE.Keybindings.OpenStudio", editable: [],
    onDown: () => {
      ParticleStudio.open();
      return true;
    }
  });
  foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/studio.hbs`,
    `modules/${MODULE_ID}/templates/manager.hbs`, `modules/${MODULE_ID}/templates/walls.hbs`,
    `modules/${MODULE_ID}/templates/wall-editor.hbs`, `modules/${MODULE_ID}/templates/outline-tools.hbs`]);
});

Hooks.once("kostisFlyingPaths.register", kfp => {
  kfp.registerSubmodule({
    id: MODULE_ID,
    open: () => ParticleStudio.open(),
    actions: [
      {label: "Scene particles", icon: "fa-solid fa-list-check", run: () => ParticleManager.open()},
      {label: "Effect walls", icon: "fa-solid fa-road-barrier", visible: () => game.user.isGM, run: () => WallManager.open()},
      {label: "Effects", icon: "fa-solid fa-wand-magic-sparkles", run: () => ParticleStudio.open({tab: "effects"})},
      {label: "Emitters", icon: "fa-solid fa-fire-flame-curved", run: () => ParticleStudio.open({tab: "emitters"})}
    ]
  });
  registerTools(kfp);

  // GM side of player requests: allowed by the world setting, on the scene the player is viewing, within limits
  const allowed = user => user?.isGM || game.settings.get(MODULE_ID, "playersCanCast");
  const check = (user, what) => {
    if ( !allowed(user) ) throw new Error(`Players may not ${what} in this world`);
  };
  kfp.relay.register(`${MODULE_ID}.spawn`, (payload, user) => {
    check(user, "spawn particles");
    playerScene(payload?.sceneId, user);
    return ParticleTokens.spawnLocal(playerSpawn(payload, user), user);
  });
  kfp.relay.register(`${MODULE_ID}.despawn`, async ({ids, sceneId}, user) => {
    check(user, "remove particles");
    const scene = playerScene(sceneId, user);
    // Players remove the particles they made, or control
    const mine = (Array.isArray(ids) ? ids : []).filter(id => {
      const doc = scene.tokens.get(id);
      const p = doc?.getFlag(MODULE_ID, FLAG_PARTICLE);
      return p && (user.isGM || (p.by === user.id) || (!!doc.actorId && doc.testUserPermission(user, "OWNER")));
    });
    if ( mine.length ) await scene.deleteEmbeddedDocuments("Token", mine, {[NO_HISTORY]: true, [MODULE_ID]: {despawn: true}});
    return mine.length;
  });
  kfp.relay.register(`${MODULE_ID}.restore`, async ({sceneId, data}, user) => {
    check(user, "restore particles");
    const scene = playerScene(sceneId, user);
    const back = playerRestore(scene, data, user);
    if ( back.length ) await scene.createEmbeddedDocuments("Token", back, {[NO_HISTORY]: true, keepId: true});
    return back.length;
  });
  kfp.relay.register(`${MODULE_ID}.cast`, (payload, user) => {
    check(user, "cast effects");
    const scene = playerScene(payload?.sceneId, user);
    const caster = payload.casterId ? scene.tokens.get(payload.casterId) : null;
    if ( caster && !user.isGM && !caster.testUserPermission(user, "OWNER") ) throw new Error("You can only cast from your own tokens");
    return Caster.castLocal(playerCast(payload, user), user);
  });
  kfp.relay.register(`${MODULE_ID}.bake`, ({preset}, user) => {
    check(user, "make particle images");
    return bake(preset);
  });
});

/* -------------------------------------------- */
/*  Double-click and Token HUD                  */
/* -------------------------------------------- */

/** Particles have no actor: double-click opens the manager instead of Foundry's "no actor" warning. */
function patchDoubleClick() {
  const proto = foundry.canvas.placeables.Token.prototype;
  const handle = function(wrapped, user, event) {
    if ( this.document?.getFlag(MODULE_ID, FLAG_PARTICLE) && !this.isPreview ) {
      if ( this.layer?.active ) ParticleManager.open({tokens: [this.id]});
      return false;
    }
    return wrapped(user, event);
  };
  if ( globalThis.libWrapper && game.modules.get("lib-wrapper")?.active ) {
    libWrapper.register(MODULE_ID, "foundry.canvas.placeables.Token.prototype._canView", function(wrapped, ...args) {
      return handle.call(this, wrapped, ...args);
    }, "MIXED");
  } else {
    const original = proto._canView;
    proto._canView = function(...args) {
      return handle.call(this, (...a) => original.apply(this, a), ...args);
    };
  }
}

Hooks.on("renderTokenHUD", (hud, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = hud.object?.document;
  if ( !root || !doc ) return;
  const decorated = doc.getFlag(MODULE_ID, FLAG_PARTICLE) || doc.getFlag(MODULE_ID, FLAG_AURAS) || doc.getFlag(MODULE_ID, FLAG_EMITTERS);
  if ( !decorated || (!game.user.isGM && !game.settings.get(MODULE_ID, "playersCanCast")) ) return;
  const col = root.querySelector(".col.left") ?? root.querySelector(".col.right");
  if ( !col || col.querySelector(".kpe-hud-btn") ) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon kpe-hud-btn";
  btn.dataset.tooltip = game.i18n.localize("KPE.Tools.Manager");
  btn.innerHTML = '<i class="fa-solid fa-wand-sparkles" inert></i>';
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    ParticleManager.open({tokens: [doc.id]});
  });
  col.appendChild(btn);
});

// Tokens capture their double-click check when they are drawn, and the first scene is drawn before "ready"
Hooks.once("setup", () => patchDoubleClick());

Hooks.once("ready", () => {
  repairParticleActor().catch(err => console.error(`${MODULE_ID} | particle actor`, err));
  EffectWallBlocks.start();
  // Walls that finished growing (or changed) while no GM was here
  for ( const scene of game.scenes ) EffectWallBlocks.sync(scene);
  LiveTextures.fps = game.settings.get(MODULE_ID, "fps");
  LiveTextures.quality = Number(game.settings.get(MODULE_ID, "quality")) || 1;
  game.socket.on(SOCKET, msg => Emitters.onSocket(msg));
  if ( !game.modules.get(HUB_ID)?.active ) ui.notifications.error("KPE.Error.NoHub", {localize: true, permanent: true});
});

/* -------------------------------------------- */
/*  Canvas & documents                          */
/* -------------------------------------------- */

const touches = changed => foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`);

Hooks.on("canvasReady", () => {
  ParticleTokens.applyAll();
  Auras.syncAll();
  Emitters.sync();
  EffectWalls.sync();
  EffectWallBlocks.sync();
  Janitor.start();
});

Hooks.on("canvasTearDown", () => {
  EffectWalls.clear();
  Emitters.clear();
  Auras.clear();
  ParticleTokens.clear();
  clearTextureCaches();
});

Hooks.on("drawToken", token => {
  ParticleTokens.apply(token);
  // Drag previews share the real token's id: auras stay with the real one
  if ( !token.isPreview ) Auras.sync(token);
});

Hooks.on("destroyToken", token => {
  ParticleTokens.forget(token);
  if ( !token.isPreview ) Auras.forget(token.id);
});

Hooks.on("updateToken", (doc, changed) => {
  const resized = ("width" in changed) || ("height" in changed);
  if ( (touches(changed) || resized) && doc.object && (doc.parent === canvas.scene) ) {
    ParticleTokens.apply(doc.object);
    Auras.sync(doc.object);
    if ( touches(changed) ) Emitters.sync();
  }
  if ( foundry.utils.hasProperty(changed, `flags.${ANIMATOR_ID}`) ) Janitor.onUpdateToken(doc, changed);
});

Hooks.on("createToken", doc => {
  if ( (doc.parent === canvas.scene) && doc.getFlag(MODULE_ID, FLAG_EMITTERS) ) setTimeout(() => Emitters.sync(), 0);
});

Hooks.on("deleteToken", (doc, options) => {
  Janitor.onDeleteToken(doc, options);
  if ( (doc.parent === canvas.scene) && doc.getFlag(MODULE_ID, FLAG_EMITTERS) ) Emitters.sync();
});

// Effect walls follow their animator paths: redraw when the walls or the paths change. Real walls are kept in step on
// every scene (a GM may change walls on a scene the active GM isn't looking at).
const wallsShown = foundry.utils.debounce(() => {
  EffectWalls.sync();
  WallManager.instance?.render();
}, 120);
const blocksPending = new Map();
const blocksChanged = scene => {
  clearTimeout(blocksPending.get(scene.id));
  blocksPending.set(scene.id, setTimeout(() => {
    blocksPending.delete(scene.id);
    EffectWallBlocks.sync(scene);
  }, 120));
};

Hooks.on("updateScene", (scene, changed) => {
  const walls = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${FLAG_WALLS}`) || foundry.utils.hasProperty(changed, `flags.${ANIMATOR_ID}`);
  if ( walls ) blocksChanged(scene);
  if ( scene !== canvas.scene ) return;
  if ( touches(changed) ) Emitters.sync();
  if ( walls ) wallsShown();
});
// (Viewing another level redraws the canvas: canvasReady syncs the walls on show)

// The studio shows how many tokens are selected and targeted; the manager follows the canvas selection
const refreshStudio = foundry.utils.debounce(() => ParticleStudio.instance?.render(), 150);
const refreshManager = foundry.utils.debounce(() => ParticleManager.instance?.render(), 120);
const managerSelection = foundry.utils.debounce(() => ParticleManager.instance?.onCanvasControl(), 80);
Hooks.on("controlToken", () => {
  refreshStudio();
  managerSelection();
});
Hooks.on("targetToken", () => {
  refreshStudio();
  refreshManager();
});
for ( const hook of ["createToken", "updateToken", "deleteToken"] ) {
  Hooks.on(hook, doc => {
    if ( doc.parent === canvas.scene ) refreshManager();
  });
}
Hooks.on(`${ANIMATOR_ID}.started`, refreshManager);
Hooks.on(`${ANIMATOR_ID}.stopped`, refreshManager);
Hooks.on("kostisFlyingPaths.history", () => {
  refreshManager();
  refreshStudio();
  WallManager.instance?.render();
});
Hooks.on("canvasReady", () => {
  ParticleManager.instance?.select([]);
  WallManager.instance?.render();
});

export {api, normalizeAura, FLAG_SPAWN};
