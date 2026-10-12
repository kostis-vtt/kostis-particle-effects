// The Effect Walls manager: every effect wall on the scene, new ones drawn with the animator's tools or put on an
// existing path, and a full editor (look edited live on the map, how it appears, what it blocks, its particles).

import {ANIMATOR_ID, HUB_ID, MODULE_ID, MODULE_TITLE} from "./const.js";
import {LINE_STYLES} from "./line-shader.js";
import {BLOCKS, MAX_LAYERS, REVEAL_MODES, normalizeLayer, normalizeWall} from "./wall-presets.js";
import {EffectWalls, sceneWalls} from "./effect-walls.js";
import {Walls} from "./walls-api.js";
import {Library} from "./library.js";
import {PALETTE_PRESETS} from "./presets.js";
import {wallEditorContext} from "./wall-ui.js";
import {wallThumbnail} from "./wall-render.js";
import {Preview} from "./preview.js";
import {selectedTokens} from "./selection.js";
import {remember} from "./undo.js";
import {ChoiceGuard, collapseUntilDrawn, finishMapWork, rememberPosition, savePosition, savedPosition} from "./window-ui.js";

const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;
const kaa = () => (game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null);
const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step >= 0.1 ? 1 : 2));

export const DRAW_TOOLS = {
  pen: {label: "Pen (click points, drag curves)", icon: "fa-solid fa-pen-nib"},
  freehand: {label: "Freehand", icon: "fa-solid fa-signature"},
  rect: {label: "Rectangle (a sealed room)", icon: "fa-regular fa-square"},
  ellipse: {label: "Circle / ellipse", icon: "fa-regular fa-circle"},
  polygon: {label: "Polygon / star", icon: "fa-solid fa-draw-polygon"},
  figure8: {label: "Figure eight", icon: "fa-solid fa-infinity"},
  spiral: {label: "Spiral", icon: "fa-solid fa-hurricane"},
  wave: {label: "Wave / zig-zag", icon: "fa-solid fa-wave-square"}
};

export class WallManager extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "kpe-walls",
    classes: ["kfp-app", "kpe-studio", "kpe-manager", "kpe-walls"],
    window: {title: `${MODULE_TITLE}: Effect walls`, icon: "fa-solid fa-road-barrier", resizable: true},
    position: {width: 960, height: 700},
    actions: {
      pickRow: WallManager.#onRow,
      drawNew: WallManager.#onDraw,
      attachNew: WallManager.#onAttach,
      undo: WallManager.#onUndo,
      openStudio: WallManager.#onStudio,
      editPath: WallManager.#onEditPath,
      restart: WallManager.#onRestart,
      toggleHidden: WallManager.#onHidden,
      removeWall: WallManager.#onRemove,
      removeWithPath: WallManager.#onRemoveWithPath,
      saveAsPreset: WallManager.#onSavePreset,
      loadPreset: WallManager.#onLoadPreset,
      wallPalette: WallManager.#onPalette,
      revert: WallManager.#onRevert,
      apply: WallManager.#onApply,
      addLayer: WallManager.#onAddLayer,
      pathSmooth: WallManager.#onPathSmooth,
      removeLayer: WallManager.#onRemoveLayer
    }
  };

  static PARTS = {
    main: {template: `modules/${MODULE_ID}/templates/walls.hbs`, scrollable: [".kpm-list", ".kpe-editor-scroll"]}
  };

  static open({wall}={}) {
    // Walls are the GM's (players can't change scene data, and hidden walls are listed here)
    if ( !game.user.isGM ) return null;
    this.#instance ??= new this({position: savedPosition(this.DEFAULT_OPTIONS.id)});
    if ( wall ) this.#instance.#select(wall);
    this.#instance.render({force: true});
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  static get instance() {
    return this.#instance;
  }

  #selected = null;

  /** Unsaved look edits of the selected wall (shown live on the map). */
  #draft = null;

  #new = {preset: "builtin-wall-of-fire", tool: "pen", path: ""};

  /** The preset chosen in "Start from". */
  #loadChoice = null;

  /** Select a wall: unsaved edits of the previous one are dropped (and no longer shown on the map). */
  #select(id) {
    if ( id === this.#selected ) return;
    if ( this.#selected ) EffectWalls.preview(this.#selected, null);
    this.#draft = null;
    this.#selected = id ?? null;
  }

  #preview = new Preview();

  #choices = new ChoiceGuard(() => this.render());

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options) {
    const scene = canvas.scene;
    const api = kaa();
    const ctx = {scene: !!scene, animator: !!api, isGM: game.user.isGM,
      undo: game.modules.get(HUB_ID)?.api?.history?.peek()?.label ?? null};
    if ( !scene ) return ctx;
    if ( !this.#preview.app ) this.#preview.mount(document.createElement("div"));
    const renderer = this.#preview.renderer;
    const walls = sceneWalls(scene);
    // The selected wall is gone (removed, undone, another scene): its edits go with it
    if ( !walls.some(w => w.id === this.#selected) ) {
      if ( this.#selected ) EffectWalls.preview(this.#selected, null);
      this.#draft = null;
      this.#selected = walls[0]?.id ?? null;
    }
    const anims = api ? api.animations(scene) : [];
    const thumb = look => {
      try {
        return renderer ? wallThumbnail(look, renderer) : "";
      } catch(err) {
        return "";
      }
    };
    ctx.rows = walls.map(w => {
      const anim = anims.find(a => a.id === w.source.animId);
      return {
        id: w.id, name: w.name, thumb: thumb(w.look), path: anim?.name ?? null, missing: !anim,
        mode: REVEAL_MODES[w.reveal.mode]?.label, modeIcon: REVEAL_MODES[w.reveal.mode]?.icon,
        blocks: w.blocks !== "none", blocksLabel: BLOCKS[w.blocks], hidden: w.hidden, selected: w.id === this.#selected,
        style: LINE_STYLES[w.look.style]?.label
      };
    });
    ctx.presets = Library.all("walls").map(p => ({value: p.id, label: `${p.name}${p.builtin ? "" : " ★"}`, selected: p.id === this.#new.preset}));
    ctx.tools = Object.entries(DRAW_TOOLS).map(([k, t]) => ({value: k, label: t.label, selected: k === this.#new.tool}));
    ctx.paths = anims.map(a => ({value: a.id, label: `${a.name}${a.tokens.length ? ` (${a.tokens.length} token${a.tokens.length === 1 ? "" : "s"})` : ""}`,
      selected: a.id === this.#new.path}));

    const cur = walls.find(w => w.id === this.#selected);
    if ( cur ) {
      const item = this.#draft ? normalizeWall({...cur, ...this.#draft, look: {...cur.look, ...(this.#draft.look ?? {})},
        reveal: {...cur.reveal, ...(this.#draft.reveal ?? {})}}) : cur;
      const anim = anims.find(a => a.id === cur.source.animId);
      const tokenIds = new Set([...(anim?.tokens ?? []), ...selectedTokens().map(t => t.id)]);
      const tokens = scene.tokens.contents.map(t => ({id: t.id, name: `${t.name}${tokenIds.has(t.id) ? " ●" : ""}`}))
        .sort((a, b) => Number(b.name.endsWith("●")) - Number(a.name.endsWith("●")) || a.name.localeCompare(b.name));
      const win = EffectWalls.windowOf(cur.id);
      ctx.wall = {
        id: cur.id, name: item.name, hidden: cur.hidden, path: anim?.name ?? null, missing: !anim, animId: cur.source.animId,
        dirty: !!this.#draft, w: wallEditorContext(item, {tokens}),
        lengthSq: win ? Math.round((win.length / scene.dimensions.size) * 10) / 10 : null,
        loop: win?.closed ?? false,
        pathChoices: anims.map(a => ({value: a.id, label: a.name, selected: a.id === cur.source.animId}))
      };
      const presets = Library.all("walls");
      if ( !presets.some(p => p.id === this.#loadChoice) ) this.#loadChoice = presets[0]?.id ?? null;
      ctx.presetsForLoad = presets.map(p => ({value: p.id, label: `${p.name}${p.builtin ? "" : " ★"}`, selected: p.id === this.#loadChoice}));
    }
    return ctx;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element.querySelector("[data-preview]");
    if ( el && context.wall ) {
      this.#preview.mount(el);
      this.#preview.showWall(this.#current() ?? context.wall);
    }
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("input", event => this.#onInput(event));
    this.element.addEventListener("change", event => this.#onChange(event));
    this.#choices.watch(this.element);
  }

  /** @override */
  render(options, _options) {
    // Never under an open dropdown (it would snap shut): the redraw follows once a choice is made
    const force = (options === true) || options?.force;
    if ( this.rendered && !force && this.#choices.hold() ) return Promise.resolve(this);
    return super.render(options, _options);
  }

  /** @override */
  setPosition(position) {
    const out = super.setPosition(position);
    rememberPosition(this);
    return out;
  }

  /** @override */
  async close(options={}) {
    // Escape while this window is tucked away for map work ends that work and brings it back (instead of closing it)
    if ( options.closeKey && finishMapWork(this) ) return this;
    return super.close(options);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    savePosition(this);
    if ( this.#selected ) EffectWalls.preview(this.#selected, null);
    this.#preview.destroy();
    WallManager.#instance = null;
  }

  /** The selected wall with unsaved edits. */
  #current() {
    const cur = sceneWalls(canvas.scene).find(w => w.id === this.#selected);
    if ( !cur ) return null;
    if ( !this.#draft ) return cur;
    return normalizeWall({...cur, ...this.#draft, look: {...cur.look, ...(this.#draft.look ?? {})}, reveal: {...cur.reveal, ...(this.#draft.reveal ?? {})}});
  }

  /** Change the draft and show it on the map (this client only). */
  #edit(path, value) {
    this.#draft ??= {};
    // One colour of the palette: keep the palette an array
    const m = path.match(/^look\.palette\.(\d)$/);
    if ( m ) {
      const palette = [...(this.#current()?.look.palette ?? [])];
      palette[Number(m[1])] = value;
      path = "look.palette";
      value = palette;
    }
    // One field of a layer: the layers change as a whole list (the draft's look is laid over the wall's key by key)
    else if ( path.startsWith("look.layers.") ) {
      const layers = foundry.utils.deepClone(this.#current()?.look.layers ?? []);
      foundry.utils.setProperty(layers, path.slice(12), value);
      path = "look.layers";
      value = layers;
    }
    foundry.utils.setProperty(this.#draft, path, value);
    EffectWalls.preview(this.#selected, this.#draft);
    const cur = this.#current();
    if ( cur ) this.#preview.showWall(cur);
    const bar = this.element.querySelector(".kpm-apply");
    bar?.classList.add("kpm-dirty");
    for ( const b of bar?.querySelectorAll("button[disabled]") ?? [] ) b.disabled = false;
  }

  #onInput(event) {
    const el = event.target;
    if ( !el.name ) return;
    if ( el.name.startsWith("new.") ) return;
    if ( (el.type === "range") || (el.type === "color") ) {
      const v = el.type === "range" ? Number(el.value) : el.value;
      this.#edit(el.name, v);
      const out = el.closest(".kfp-range")?.querySelector("output");
      if ( out ) out.textContent = fmt(Number(el.value), Number(el.step) || 1);
    }
  }

  async #onChange(event) {
    const el = event.target;
    const name = el.name;
    if ( !name ) return;
    if ( name.startsWith("new.") ) {
      this.#new[name.slice(4)] = el.value;
      return;
    }
    if ( name === "loadPreset" ) {
      this.#loadChoice = el.value;
      return;
    }
    if ( (el.type === "range") || (el.type === "color") ) return;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if ( el.type === "number" ) value = Number(value);
    if ( name === "path" ) {
      await Walls.update(this.#selected, {source: {animId: value}});
      return this.render();
    }
    if ( name === "name" ) {
      await Walls.update(this.#selected, {name: value});
      return this.render();
    }
    // Structure changes (mode, style…) show at once and re-render the form
    this.#edit(name, value === "" && name === "reveal.token" ? null : value);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onRow(_event, target) {
    const id = target.closest("[data-wall]").dataset.wall;
    if ( id === this.#selected ) return;
    this.#select(id);
    this.render();
  }

  static async #onDraw() {
    const wall = await Walls.draw(this.#new.preset, {tool: this.#new.tool});
    if ( wall ) this.#select(wall.id);
    this.render();
    // Out of the way while the path is drawn; back once it has a shape
    if ( wall ) collapseUntilDrawn(this, wall.source.animId);
  }

  static async #onAttach() {
    const animId = this.#new.path || this.element.querySelector("[name='new.path']")?.value;
    if ( !animId ) return ui.notifications.warn("KPE.Warn.PickPath", {localize: true});
    const wall = await Walls.attach(this.#new.preset, animId);
    if ( wall ) this.#select(wall.id);
    this.render();
  }

  static async #onUndo() {
    await game.modules.get(HUB_ID)?.api?.history?.undo();
    this.render();
  }

  static #onStudio() {
    game.modules.get(MODULE_ID).api.openStudio({tab: "walls"});
  }

  static #onEditPath() {
    const w = Walls.get(this.#selected);
    if ( w?.source.animId ) kaa()?.draw(w.source.animId, "edit");
  }

  /** Make every point of the wall's path a sharp corner (a room) or a round curve (data-smooth 0 or 1). */
  static async #onPathSmooth(_event, target) {
    const w = Walls.get(this.#selected);
    const api = kaa();
    const anim = w?.source.animId ? api?.getAnimation(w.source.animId) : null;
    if ( !anim || (typeof api.setSmooth !== "function") ) return;
    const before = foundry.utils.deepClone(anim);
    const round = target.dataset.smooth === "1";
    await api.setSmooth(anim.id, round ? 1 : 0);
    remember(game.i18n.format(round ? "KPE.Undo.PathCurves" : "KPE.Undo.PathCorners", {name: w.name}),
      () => api.updateAnimation(before.id, () => before), canvas.scene);
    this.render();
  }

  static async #onRestart() {
    await Walls.restart(this.#selected);
    this.render();
  }

  static async #onHidden() {
    const w = Walls.get(this.#selected);
    if ( !w ) return;
    await Walls.update(w.id, {hidden: !w.hidden});
    this.render();
  }

  static async #onRemove() {
    if ( this.#selected ) EffectWalls.preview(this.#selected, null);
    this.#draft = null;
    await Walls.remove(this.#selected);
    this.render();
  }

  static async #onRemoveWithPath() {
    const ok = await DialogV2.confirm({window: {title: "Remove wall and path"},
      content: "<p>Remove this wall <strong>and</strong> the animator path it follows? (Ctrl+Z brings both back.)</p>"});
    if ( !ok ) return;
    if ( this.#selected ) EffectWalls.preview(this.#selected, null);
    this.#draft = null;
    await Walls.remove(this.#selected, {withPath: true});
    this.render();
  }

  static async #onSavePreset() {
    const cur = this.#current();
    if ( !cur ) return;
    const saved = await Library.save("walls", {...cur, id: null, name: cur.name, description: ""}, {copy: true});
    ui.notifications.info(game.i18n.format("KPE.Info.Saved", {name: saved.name}));
    this.render();
  }

  static #onLoadPreset() {
    const id = this.#loadChoice ?? this.element.querySelector("[name='loadPreset']")?.value;
    const p = Library.get("walls", id);
    if ( !p ) return;
    this.#draft = {look: {...p.look}, reveal: {...p.reveal, start: game.time.serverTime}, blocks: p.blocks, emitter: p.emitter,
      emitterRate: p.emitterRate, below: p.below};
    EffectWalls.preview(this.#selected, this.#draft);
    this.render();
  }

  static #onPalette(_event, target) {
    const colors = PALETTE_PRESETS[target.dataset.palette];
    if ( !colors ) return;
    this.#edit("look.palette", [...colors]);
    this.render();
  }

  static #onRevert() {
    this.#draft = null;
    EffectWalls.preview(this.#selected, null);
    this.render();
  }

  /** Add a line beside the wall or a star across it. */
  static #onAddLayer(_event, target) {
    const layers = [...(this.#current()?.look.layers ?? [])];
    if ( layers.length >= MAX_LAYERS ) return;
    layers.push(normalizeLayer({kind: target.dataset.kind}));
    this.#edit("look.layers", layers);
    this.render();
  }

  static #onRemoveLayer(_event, target) {
    const layers = [...(this.#current()?.look.layers ?? [])];
    layers.splice(Number(target.dataset.layer), 1);
    this.#edit("look.layers", layers);
    this.render();
  }

  /** Make the edits permanent (for everyone). */
  static async #onApply() {
    if ( !this.#draft ) return;
    const draft = this.#draft;
    this.#draft = null;
    EffectWalls.preview(this.#selected, null);
    await Walls.update(this.#selected, draft);
    this.render();
  }
}
