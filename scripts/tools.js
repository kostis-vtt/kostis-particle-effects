// Tools in the shared "Kostis's Flying Paths" scene controls.

import {FLAG_EMITTERS, MODULE_ID} from "./const.js";
import {State} from "./state.js";
import {MoldTool} from "./mold-tool.js";
import {restoreFor} from "./window-ui.js";

const api = () => game.modules.get(MODULE_ID).api;
const playersCast = () => game.settings.get(MODULE_ID, "playersCanCast");

/** Snap a click to the grid unless Shift is held (particles are grid-free by default). */
function pointOf(event, p) {
  if ( !event?.shiftKey ) return p;
  return canvas.grid.getSnappedPoint(p, {mode: CONST.GRID_SNAPPING_MODES.CENTER});
}

export function registerTools(kfp) {
  kfp.registerTool({
    name: "kpeStudio", submodule: MODULE_ID, order: 10, button: true,
    title: "KPE.Tools.Studio", icon: "fa-solid fa-wand-sparkles",
    visible: () => game.user.isGM || playersCast(),
    onChange: () => api().openStudio()
  });
  kfp.registerTool({
    name: "kpeManager", submodule: MODULE_ID, order: 10.5, button: true,
    title: "KPE.Tools.Manager", icon: "fa-solid fa-list-check",
    visible: () => game.user.isGM || playersCast(),
    onChange: () => api().openManager()
  });
  kfp.registerTool({
    name: "kpeWalls", submodule: MODULE_ID, order: 10.7, button: true,
    title: "KPE.Tools.Walls", icon: "fa-solid fa-road-barrier",
    visible: () => game.user.isGM,
    onChange: () => api().openWalls()
  });
  kfp.registerTool({
    name: "kpePlace", submodule: MODULE_ID, order: 11,
    title: "KPE.Tools.Place", icon: "fa-solid fa-circle-nodes",
    visible: () => game.user.isGM,
    canvas: {
      click: async (event, p) => {
        const preset = State.current("particles");
        if ( preset ) await api().spawn(preset, pointOf(event, p));
      },
      deactivate: () => restoreFor("kpePlace")
    }
  });
  kfp.registerTool({
    name: "kpeMold", submodule: MODULE_ID, order: 11.5,
    title: "KPE.Tools.Mold", icon: "fa-solid fa-hand",
    visible: () => game.user.isGM || playersCast(),
    canvas: MoldTool.handlers
  });
  kfp.registerTool({
    name: "kpeEmitter", submodule: MODULE_ID, order: 12,
    title: "KPE.Tools.Emitter", icon: "fa-solid fa-fire-flame-curved",
    visible: () => game.user.isGM,
    canvas: {
      click: async (event, p) => {
        const emitter = State.current("emitters");
        if ( !emitter ) return;
        if ( emitter.oneShot ) return api().burst(emitter, p);
        await api().placeEmitter(pointOf(event, p), emitter);
      },
      rightClick: async (_event, p) => {
        // Remove the nearest fixed emitter within one square
        const list = Object.entries(canvas.scene.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {});
        let best = null;
        let bestD = canvas.dimensions.size;
        for ( const [id, e] of list ) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if ( d < bestD ) {
            bestD = d;
            best = id;
          }
        }
        if ( best ) await api().removeSceneEmitter(best);
      },
      deactivate: () => restoreFor("kpeEmitter")
    }
  });
  kfp.registerTool({
    name: "kpeCast", submodule: MODULE_ID, order: 13,
    title: "KPE.Tools.Cast", icon: "fa-solid fa-wand-magic-sparkles",
    visible: () => game.user.isGM || playersCast(),
    canvas: {
      click: async (event, p) => {
        const effect = State.current("effects");
        if ( effect ) await api().cast(effect, {point: pointOf(event, p)});
      },
      deactivate: () => restoreFor("kpeCast")
    }
  });
  kfp.registerTool({
    name: "kpeClear", submodule: MODULE_ID, order: 14, button: true,
    title: "KPE.Tools.Clear", icon: "fa-solid fa-broom",
    visible: () => game.user.isGM,
    onChange: () => api().clearScene({confirm: true})
  });
}
