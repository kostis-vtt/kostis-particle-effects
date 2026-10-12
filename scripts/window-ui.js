// What the module's windows share: they step aside while you work on the map (collapsed to their title bar, back when
// you are done), they remember their size and place, and they never redraw under an open dropdown.

import {ANIMATOR_ID, HUB_ID} from "./const.js";

/* -------------------------------------------- */
/*  Out of the way while you work on the map    */
/* -------------------------------------------- */

/** Windows collapsed for a piece of map work (a map tool's name, or "draw:<animation id>"), and their collapsing. */
const collapsed = new Map();

/** Collapse a window to its title bar while some map work goes on (see restoreFor). */
export function collapseFor(key, app) {
  if ( !app?.rendered || app.minimized || (app.options?.window?.minimizable === false) ) return;
  if ( !collapsed.has(key) ) collapsed.set(key, new Map());
  collapsed.get(key).set(app, Promise.resolve(app.minimize()).catch(() => null));
}

/** The map work is done: bring its windows back (once they have finished collapsing). */
export async function restoreFor(key) {
  const apps = collapsed.get(key);
  collapsed.delete(key);
  for ( const [app, collapsing] of apps ?? [] ) {
    await collapsing;
    if ( app.rendered && app.minimized ) await app.maximize();
  }
}

/** The map work a window is collapsed for, if any. */
export function collapsedFor(app) {
  for ( const [key, apps] of collapsed ) if ( apps.has(app) ) return key;
  return null;
}

/**
 * Collapse a window while a path is drawn for a new effect wall: it comes back once the path has a shape (or is gone).
 * @param {ApplicationV2} app
 * @param {string} animId     The animator animation being drawn
 */
export function collapseUntilDrawn(app, animId) {
  const key = `draw:${animId}`;
  collapseFor(key, app);
  if ( !collapsed.has(key) ) return;
  const id = Hooks.on("updateScene", () => {
    const anim = game.modules.get(ANIMATOR_ID)?.api?.getAnimation?.(animId);
    if ( anim && !anim.steps?.length ) return;
    Hooks.off("updateScene", id);
    restoreFor(key);
  });
}

/**
 * Escape while a window is collapsed for map work: end that work and bring the window back (Foundry would close it).
 * @returns {boolean}   Whether there was such work
 */
export function finishMapWork(app) {
  const key = collapsedFor(app);
  if ( !key ) return false;
  // A map tool ends by switching back to the selection tool (the tool brings its windows back as it is put away)
  if ( !key.startsWith("draw:") && game.modules.get(HUB_ID)?.api?.layer?.tool?.name === key ) {
    game.modules.get(HUB_ID).api.activateTool("kfpSelect");
  }
  restoreFor(key);
  return true;
}

/* -------------------------------------------- */
/*  Size and place                              */
/* -------------------------------------------- */

const STORE = "kostis-windows";

function stored() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORE) ?? "{}") ?? {};
  } catch(err) {
    return {};
  }
}

/** Where a window was left last time in this browser ({left, top, width, height}), to open it there again. */
export function savedPosition(id) {
  const p = stored()[id];
  const out = {};
  for ( const k of ["left", "top", "width", "height"] ) if ( Number.isFinite(p?.[k]) ) out[k] = p[k];
  return out;
}

/** Remember where a window is now. */
export function savePosition(app) {
  const {left, top, width, height} = app?.position ?? {};
  if ( !app?.id || ![left, top, width, height].every(Number.isFinite) ) return;
  try {
    const all = stored();
    all[app.id] = {left, top, width, height};
    globalThis.localStorage?.setItem(STORE, JSON.stringify(all));
  } catch(err) {
    // (Storage can be unavailable, e.g. in a private window: the window just opens where it always did)
  }
}

const timers = new WeakMap();

/** Remember where a window is once it has stopped moving. */
export function rememberPosition(app) {
  clearTimeout(timers.get(app));
  timers.set(app, setTimeout(() => savePosition(app), 400));
}

/* -------------------------------------------- */
/*  Not under an open dropdown                  */
/* -------------------------------------------- */

/**
 * Keeps a window from redrawing while one of its dropdowns is open (the redraw would snap it shut): the redraw waits
 * until a choice is made or the dropdown is left.
 */
export class ChoiceGuard {
  #open = false;

  #waiting = false;

  /** @param {() => void} redraw   How the window redraws when it may again */
  constructor(redraw) {
    this.redraw = redraw;
  }

  /** Watch a window's element (once, after its first render). */
  watch(element) {
    element.addEventListener("pointerdown", event => {
      if ( event.target?.closest?.("select") ) this.#open = true;
    }, true);
    element.addEventListener("change", event => {
      if ( event.target?.tagName === "SELECT" ) this.#open = false;
    }, true);
    element.addEventListener("focusout", event => {
      if ( event.target?.tagName !== "SELECT" ) return;
      this.#open = false;
      if ( !this.#waiting ) return;
      this.#waiting = false;
      this.redraw();
    }, true);
  }

  /** Should a redraw wait? (It happens once the dropdown is closed.) */
  hold() {
    if ( !this.#open ) return false;
    this.#waiting = true;
    return true;
  }
}
