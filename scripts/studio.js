// The Particle Studio: browse, edit, save and use particles, emitters and effects, with a live preview.

import {ANIMATOR_ID, HUB_ID, MODULE_ID, MODULE_TITLE} from "./const.js";
import {KINDS} from "./shader.js";
import {CATEGORIES, LOOK_FIELDS, PALETTE_PRESETS, normalizePreset} from "./presets.js";
import {AREAS, BEHAVIORS, BLENDS, EMITTER_FIELDS, normalizeEmitter} from "./emitter-presets.js";
import {ANCHORS, LIFETIMES, SPAWN_AT, normalizeEffect} from "./effect-presets.js";
import {EFFECT_OWNERS} from "./ownership.js";
import {Library} from "./library.js";
import {Preview} from "./preview.js";
import {emitterParticle} from "./emitters.js";
import {bake} from "./textures.js";
import {State} from "./state.js";
import {selectedTokens} from "./selection.js";
import {LINE_STYLES} from "./line-shader.js";
import {MAX_LAYERS, normalizeLayer, normalizeWallPreset} from "./wall-presets.js";
import {wallEditorContext} from "./wall-ui.js";
import {wallThumbnail} from "./wall-render.js";
import {DRAW_TOOLS} from "./wall-manager.js";
import {MoldControls, outlineToolsContext} from "./outline-editor.js";
import {ChoiceGuard, collapseFor, collapseUntilDrawn, finishMapWork, rememberPosition, savePosition, savedPosition} from "./window-ui.js";

const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;

const LOOK_GROUPS = [
  {label: "Shape", keys: ["size", "shape"]},
  {label: "Pattern", keys: ["scale", "detail", "warp", "veins"]},
  {label: "Motion", keys: ["swirl", "spin", "pulse", "pulseRate"]},
  {label: "Light", keys: ["glow", "core", "rim", "sparkle", "alpha"]}
];
const EMITTER_GROUPS = [
  {label: "Flow", keys: ["rate", "count", "burst"]},
  {label: "Life", keys: ["lifeMin", "lifeMax", "fadeIn", "fadeOut"]},
  {label: "Movement", keys: ["speedMin", "speedMax", "angle", "spread", "gravity", "orbitSpeed"]},
  {label: "Look", keys: ["radius", "sizeMin", "sizeMax", "grow", "alphaMin", "alphaMax", "spin"]}
];
const TAB_CATEGORIES = {
  particles: CATEGORIES,
  emitters: {emitters: {label: "Emitters", icon: "fa-solid fa-fire-flame-curved"}, bursts: {label: "Bursts", icon: "fa-solid fa-burst"},
    mine: {label: "My emitters", icon: "fa-solid fa-bookmark"}},
  effects: {effects: {label: "Effects", icon: "fa-solid fa-wand-magic-sparkles"}, mine: {label: "My effects", icon: "fa-solid fa-bookmark"}},
  walls: {walls: {label: "Wall styles", icon: "fa-solid fa-road-barrier"}, mine: {label: "My walls", icon: "fa-solid fa-bookmark"}}
};
const NORMALIZE = {particles: normalizePreset, emitters: normalizeEmitter, effects: normalizeEffect, walls: normalizeWallPreset};
const selectOptions = (record, value) => Object.entries(record).map(([k, v]) => ({value: k, label: v.label ?? v, selected: k === value}));
const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step >= 0.1 ? 1 : 2));

export class ParticleStudio extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "kpe-studio",
    classes: ["kfp-app", "kpe-studio"],
    window: {title: `${MODULE_TITLE}: Studio`, icon: "fa-solid fa-wand-sparkles", resizable: true},
    position: {width: 1000, height: 700},
    actions: {
      switchTab: ParticleStudio.#onTab,
      pickCategory: ParticleStudio.#onCategory,
      selectItem: ParticleStudio.#onSelect,
      newItem: ParticleStudio.#onNew,
      saveItem: ParticleStudio.#onSave,
      saveCopy: ParticleStudio.#onSaveCopy,
      resetItem: ParticleStudio.#onReset,
      deleteItem: ParticleStudio.#onDelete,
      randomSeed: ParticleStudio.#onRandomSeed,
      usePalette: ParticleStudio.#onPalette,
      spawnOnMap: ParticleStudio.#onSpawnTool,
      attachAura: ParticleStudio.#onAttachAura,
      removeAuras: ParticleStudio.#onRemoveAuras,
      bakeImage: ParticleStudio.#onBake,
      attachEmitter: ParticleStudio.#onAttachEmitter,
      removeEmitters: ParticleStudio.#onRemoveEmitters,
      placeEmitter: ParticleStudio.#onPlaceEmitter,
      burstHere: ParticleStudio.#onBurst,
      castEffect: ParticleStudio.#onCast,
      wallPalette: ParticleStudio.#onWallPalette,
      drawWall: ParticleStudio.#onDrawWall,
      openWalls: ParticleStudio.#onOpenWalls,
      undo: ParticleStudio.#onUndo,
      openManager: ParticleStudio.#onOpenManager,
      moldToggle: ParticleStudio.#onMold,
      moldDraw: ParticleStudio.#onMold,
      moldSharp: ParticleStudio.#onMold,
      moldRound: ParticleStudio.#onMold,
      moldMirror: ParticleStudio.#onMold,
      moldReset: ParticleStudio.#onMold,
      addLayer: ParticleStudio.#onAddLayer,
      shapeMotion: ParticleStudio.#onShapeMotion,
      removeLayer: ParticleStudio.#onRemoveLayer
    }
  };

  static PARTS = {
    main: {template: `modules/${MODULE_ID}/templates/studio.hbs`, scrollable: [".kpe-grid", ".kpe-editor-scroll"]}
  };

  static open({tab}={}) {
    this.#instance ??= new this({position: savedPosition(this.DEFAULT_OPTIONS.id)});
    if ( tab ) this.#instance.#tab = tab;
    this.#instance.render({force: true});
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  static get instance() {
    return this.#instance;
  }

  #tab = "particles";

  #category = {particles: "orbs", emitters: "emitters", effects: "effects", walls: "walls"};

  /** The animator tool new walls are drawn with. */
  #wallTool = "pen";

  #search = "";

  /** Unsaved edits of the selected item, per tab. */
  #draft = {particles: null, emitters: null, effects: null, walls: null};

  #dirty = {particles: false, emitters: false, effects: false, walls: false};

  #preview = new Preview();

  #choices = new ChoiceGuard(() => this.render());

  /** Waiting for a template saved from an effect's motion: {id, name, known} (the effect, and the template ids before). */
  #motionWatch = null;

  #settingHooks = [];

  /** Molding the particle's outline by hand, over the preview. */
  #mold = new MoldControls({
    get: () => this.#current("particles")?.outline ?? null,
    set: (outline, final) => this.#setOutline(outline, final)
  });

  get api() {
    return game.modules.get(MODULE_ID).api;
  }

  /** The item being edited on a tab (a normalized copy). */
  #current(tab=this.#tab) {
    if ( !this.#draft[tab] ) {
      const id = State.selected[tab];
      const item = Library.get(tab, id) ?? Library.all(tab).find(x => this.#inCategory(tab, x)) ?? Library.all(tab)[0];
      this.#draft[tab] = item ? foundry.utils.deepClone(item) : null;
      this.#dirty[tab] = false;
      if ( item ) State.select(tab, item.id);
    }
    return this.#draft[tab];
  }

  #inCategory(tab, item) {
    const cat = this.#category[tab];
    if ( cat === "mine" ) return !item.builtin;
    if ( tab === "emitters" ) return item.builtin && ((cat === "bursts") === !!item.oneShot);
    return item.builtin && (item.category === cat);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options) {
    // The preview app must exist before thumbnails are rendered
    if ( !this.#preview.app ) this.#preview.mount(document.createElement("div"));
    const tab = this.#tab;
    const cats = TAB_CATEGORIES[tab];
    const all = Library.all(tab);
    const q = this.#search.trim().toLowerCase();
    const current = this.#current(tab);
    const thumbOf = item => {
      try {
        if ( tab === "particles" ) return this.#preview.thumb(item);
        if ( tab === "emitters" ) return this.#preview.thumb(emitterParticle(item));
        if ( tab === "walls" ) return this.#preview.renderer ? wallThumbnail(item.look, this.#preview.renderer, 96, 96) : "";
        return this.#preview.thumb(Library.get("particles", item.particle) ?? Library.get("particles", "builtin-spark"));
      } catch(err) {
        console.warn(`${MODULE_ID} | thumbnail`, err);
        return "";
      }
    };
    const cards = all.filter(x => this.#inCategory(tab, x)).map(x => ({
      id: x.id, name: x.name, description: x.description, builtin: x.builtin, thumb: thumbOf(x),
      selected: x.id === current?.id, edited: !!x.edited,
      hidden: !!q && !`${x.name} ${x.description}`.toLowerCase().includes(q),
      badge: tab === "particles" ? KINDS[x.kind]?.label : (tab === "emitters" ? (x.oneShot ? "burst" : `${x.rate}/s`)
        : (tab === "walls" ? LINE_STYLES[x.look.style]?.label : null))
    }));
    const categories = Object.entries(cats).map(([key, c]) => ({
      key, ...c, active: key === this.#category[tab],
      count: all.filter(x => (key === "mine" ? !x.builtin : (tab === "emitters" ? (x.builtin && ((key === "bursts") === !!x.oneShot)) : (x.builtin && x.category === key)))).length
    }));
    return {
      tab, tabs: [
        {key: "particles", label: "Particles", icon: "fa-solid fa-circle-nodes", active: tab === "particles"},
        {key: "emitters", label: "Emitters", icon: "fa-solid fa-fire-flame-curved", active: tab === "emitters"},
        {key: "effects", label: "Effects", icon: "fa-solid fa-wand-magic-sparkles", active: tab === "effects"},
        {key: "walls", label: "Walls", icon: "fa-solid fa-road-barrier", active: tab === "walls"}
      ],
      categories, cards, search: this.#search, empty: !cards.length,
      item: current, dirty: this.#dirty[tab], isGM: game.user.isGM,
      edited: !!current?.builtin && Library.edited(tab, current.id),
      canSave: game.user.isGM,
      editor: current ? this.#editorContext(tab, current) : null,
      selected: selectedTokens().length,
      undo: game.modules.get(HUB_ID)?.api?.history?.peek()?.label ?? null,
      targets: game.user.targets.size
    };
  }

  #slider(obj, key, f) {
    return {key, label: f.label, min: f.min, max: f.max, step: f.step, value: obj[key], text: fmt(obj[key], f.step)};
  }

  #editorContext(tab, item) {
    if ( tab === "walls" ) {
      return {
        walls: true,
        w: wallEditorContext(item),
        tools: Object.entries(DRAW_TOOLS).map(([k, t]) => ({value: k, label: t.label, selected: k === this.#wallTool})),
        animator: !!game.modules.get(ANIMATOR_ID)?.active
      };
    }
    if ( tab === "particles" ) {
      return {
        particles: true,
        kinds: selectOptions(KINDS, item.kind),
        palette: item.palette.map((c, i) => ({i, value: c})),
        palettes: Object.entries(PALETTE_PRESETS).map(([key, colors]) => ({key, colors, gradient: `linear-gradient(90deg, ${colors.join(", ")})`})),
        outline: outlineToolsContext(item.outline, this.#mold.molding),
        groups: LOOK_GROUPS.map(g => ({label: g.label,
          fields: g.keys.map(k => ({...this.#slider(item.look, k, LOOK_FIELDS[k]), key: `look.${k}`}))})),
        token: item.token,
        lightAnimations: ["none", "pulse", "torch", "flame", "wave", "fog", "energy"].map(v => ({value: v, label: v, selected: v === item.token.light.animation}))
      };
    }
    if ( tab === "emitters" ) {
      const particles = Library.all("particles");
      const pid = typeof item.particle === "object" ? item.particle.id : item.particle;
      return {
        emitters: true,
        particleOptions: [{value: "inherit", label: "The token's own colours (inherit)", selected: pid === "inherit"},
          ...particles.map(p => ({value: p.id, label: `${p.name}${p.builtin ? "" : " ★"}`, selected: p.id === pid}))],
        areas: selectOptions(AREAS, item.area),
        behaviors: selectOptions(BEHAVIORS, item.behavior),
        blends: selectOptions(BLENDS, item.blend),
        groups: EMITTER_GROUPS.map(g => ({label: g.label, fields: g.keys.map(k => this.#slider(item, k, EMITTER_FIELDS[k]))}))
      };
    }
    const particles = Library.all("particles");
    const emitters = Library.all("emitters");
    const kaa = game.modules.get(ANIMATOR_ID);
    const templates = kaa?.active ? kaa.api.templates() : [];
    const opt = (list, value, filter=() => true) => [{value: "", label: "None", selected: !value},
      ...list.filter(filter).map(x => ({value: x.id, label: `${x.name}${x.builtin === false ? " ★" : ""}`, selected: x.id === value}))];
    return {
      effects: true,
      particleOptions: particles.map(p => ({value: p.id, label: p.name, selected: p.id === item.particle})),
      spawnAt: selectOptions(SPAWN_AT, item.spawnAt),
      anchors: selectOptions(ANCHORS, item.anchor),
      lifetimes: selectOptions(LIFETIMES, item.lifetime),
      owners: selectOptions(EFFECT_OWNERS, item.owners),
      animator: !!kaa?.active,
      canShapeMotion: !!kaa?.active && !!item.animation && (typeof kaa.api?.editTemplate === "function"),
      templateOptions: opt(templates.map(t => ({...t, name: `${t.category === "attacks" ? "⚔ " : ""}${t.name}`})), item.animation),
      trailOptions: opt(emitters, item.trail, e => !e.oneShot),
      impactOptions: opt(emitters, item.impact, e => e.oneShot),
      auraOptions: opt(particles, item.casterAura, p => ["aura", "rune", "bubble", "vortex"].includes(p.kind)),
      timed: item.lifetime === "timed"
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#preview.mount(this.element.querySelector("[data-preview]"));
    this.#showPreview();
    this.#mold.attach(this.#tab === "particles" ? this.element.querySelector("[data-preview]") : null);
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("input", event => this.#onInput(event));
    this.element.addEventListener("change", event => this.#onChange(event));
    this.#choices.watch(this.element);
    // A motion shaped by hand and saved as a template becomes the effect's motion
    const onSetting = setting => {
      if ( setting?.key === `${ANIMATOR_ID}.library` ) this.#onTemplatesChanged();
    };
    this.#settingHooks = [["createSetting", Hooks.on("createSetting", onSetting)], ["updateSetting", Hooks.on("updateSetting", onSetting)]];
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
    for ( const [name, id] of this.#settingHooks ) Hooks.off(name, id);
    this.#settingHooks = [];
    this.#mold.destroy();
    this.#preview.destroy();
    ParticleStudio.#instance = null;
  }

  #showPreview() {
    const item = this.#current();
    if ( !item || !this.#preview.app ) return;
    if ( this.#tab === "particles" ) this.#preview.showParticle(item);
    else if ( this.#tab === "emitters" ) this.#preview.showEmitter(item, emitterParticle(item));
    else if ( this.#tab === "walls" ) this.#preview.showWall(item);
    else this.#preview.showParticle(Library.get("particles", item.particle) ?? Library.get("particles", "builtin-spark"));
  }

  /** Read a form control into the draft. */
  #read(el) {
    const item = this.#current();
    if ( !item || !el.name || (el.name === "search") || (el.name === "moldShape") ) return false;
    if ( el.name === "wallTool" ) {
      this.#wallTool = el.value;
      return false;
    }
    let v = el.type === "checkbox" ? el.checked : el.value;
    // An emptied optional field means "none" (check before turning numbers into numbers: Number("") is 0)
    if ( (v === "") && el.dataset.nullable ) v = null;
    else if ( (el.type === "range") || (el.type === "number") || el.dataset.dtype === "Number" ) v = Number(v);
    if ( el.name.startsWith("palette.") ) {
      item.palette[Number(el.name.slice(8))] = v;
    } else foundry.utils.setProperty(item, el.name, v);
    this.#draft[this.#tab] = NORMALIZE[this.#tab]({...item, builtin: item.builtin, category: item.category});
    this.#draft[this.#tab].id = item.id;
    this.#dirty[this.#tab] = true;
    return true;
  }

  #onInput(event) {
    const el = event.target;
    if ( el.name === "search" ) {
      this.#search = el.value;
      const q = this.#search.trim().toLowerCase();
      for ( const card of this.element.querySelectorAll(".kpe-card") ) {
        card.hidden = !!q && !card.dataset.search.toLowerCase().includes(q);
      }
      return;
    }
    if ( !this.#read(el) ) return;
    // Sliders update their read-out and the preview without a full render
    const out = el.closest(".kfp-range")?.querySelector("output");
    if ( out ) out.textContent = fmt(Number(el.value), Number(el.step) || 1);
    this.element.querySelector(".kpe-save")?.classList.add("kpe-dirty");
    this.#showPreview();
  }

  #onChange(event) {
    const el = event.target;
    if ( (el.type === "range") || (el.name === "search") ) return;
    if ( el.name === "moldShape" ) {
      if ( el.value ) this.#mold.shape(el.value);
      return;
    }
    if ( !this.#read(el) ) return;
    if ( el.name === "kind" ) {
      // A new kind starts from that kind's look
      const item = this.#current();
      this.#draft.particles = normalizePreset({...item, look: undefined});
      this.#draft.particles.id = item.id;
    }
    this.render();
  }

  /** A new outline for the particle being edited (shown at once; the app catches up when the gesture ends). */
  #setOutline(outline, final) {
    const item = this.#current("particles");
    if ( !item ) return;
    item.outline = outline;
    this.#dirty.particles = true;
    this.#preview.showParticle(item);
    this.element?.querySelector(".kpe-save")?.classList.add("kpe-dirty");
    if ( final ) this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Effects: put the effect's motion (its animator template) on the map to reshape by hand. Saving it as a template
   * in the animator makes it this effect's motion.
   */
  static async #onShapeMotion() {
    const effect = this.#current("effects");
    const kaa = game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null;
    if ( !effect?.animation || (typeof kaa?.editTemplate !== "function") ) return;
    this.#motionWatch = {id: effect.id, name: effect.name, known: new Set(kaa.templates().map(t => t.id))};
    const anim = await kaa.editTemplate(effect.animation, {tokens: selectedTokens()});
    if ( anim ) ui.notifications.info("KPE.Info.ShapeMotion", {localize: true});
    else this.#motionWatch = null;
  }

  /** The animator's templates changed: a new one saved from the motion being shaped becomes the effect's motion. */
  #onTemplatesChanged() {
    const watch = this.#motionWatch;
    const kaa = game.modules.get(ANIMATOR_ID)?.api;
    if ( !watch || !kaa ) return;
    const added = kaa.templates().find(t => !watch.known.has(t.id));
    if ( !added ) return;
    this.#motionWatch = null;
    const item = this.#draft.effects;
    // (Only if the same effect is still being edited)
    if ( !item || (item.id ? (item.id !== watch.id) : (item.name !== watch.name)) ) return;
    item.animation = added.id;
    this.#dirty.effects = true;
    ui.notifications.info(game.i18n.format("KPE.Info.MotionLinked", {name: added.name}));
    this.render();
  }

  /** Walls: add a line beside the wall or a star across it. */
  static #onAddLayer(_event, target) {
    const item = this.#current("walls");
    if ( !item || (item.look.layers.length >= MAX_LAYERS) ) return;
    item.look.layers.push(normalizeLayer({kind: target.dataset.kind}));
    this.#dirty.walls = true;
    this.render();
  }

  static #onRemoveLayer(_event, target) {
    const item = this.#current("walls");
    if ( !item ) return;
    item.look.layers.splice(Number(target.dataset.layer), 1);
    this.#dirty.walls = true;
    this.render();
  }

  static #onMold(_event, target) {
    if ( this.#mold.action(target.dataset.action) ) this.render();
  }

  static #onTab(_event, target) {
    this.#tab = target.dataset.tab;
    this.render();
  }

  static #onCategory(_event, target) {
    this.#category[this.#tab] = target.dataset.category;
    this.render();
  }

  static async #onSelect(_event, target) {
    const id = target.closest("[data-id]").dataset.id;
    if ( this.#dirty[this.#tab] && !(await this.#confirmDiscard()) ) return;
    State.select(this.#tab, id);
    this.#draft[this.#tab] = null;
    this.render();
  }

  async #confirmDiscard() {
    return DialogV2.confirm({window: {title: "Unsaved changes"}, content: "<p>Discard your changes to this item?</p>"});
  }

  static #onNew() {
    const base = {particles: {name: "New particle", kind: "orb", palette: PALETTE_PRESETS.arcane},
      emitters: {name: "New emitter", particle: "inherit"}, effects: {name: "New effect"},
      walls: {name: "New wall", look: {style: "fire"}}}[this.#tab];
    this.#draft[this.#tab] = NORMALIZE[this.#tab]({...base, seed: Math.floor(Math.random() * 99999)});
    this.#dirty[this.#tab] = true;
    this.#category[this.#tab] = "mine";
    this.render();
  }

  /** Save the changes: to the user's own item, or to a built-in (for this world; Reset brings back the original). */
  static async #onSave() {
    const item = this.#current();
    if ( !item ) return;
    const saved = await Library.save(this.#tab, item);
    State.select(this.#tab, saved.id);
    this.#draft[this.#tab] = null;
    if ( !saved.builtin ) this.#category[this.#tab] = "mine";
    ui.notifications.info(game.i18n.format("KPE.Info.Saved", {name: saved.name}));
    this.render();
  }

  /** Bring back a built-in as it ships. */
  static async #onReset() {
    const item = this.#current();
    if ( !item?.builtin || !Library.edited(this.#tab, item.id) ) return;
    const ok = await DialogV2.confirm({window: {title: "Reset"},
      content: `<p>Bring back the original <strong>${foundry.utils.escapeHTML(item.name)}</strong>? Your changes to it are lost.</p>`});
    if ( !ok ) return;
    await Library.reset(this.#tab, item.id);
    this.#draft[this.#tab] = null;
    this.#dirty[this.#tab] = false;
    this.render();
  }

  static async #onSaveCopy() {
    const item = this.#current();
    if ( !item ) return;
    const saved = await Library.save(this.#tab, {...item, id: null, name: item.builtin ? item.name : `${item.name} (copy)`}, {copy: true});
    State.select(this.#tab, saved.id);
    this.#draft[this.#tab] = null;
    this.#category[this.#tab] = "mine";
    this.render();
  }

  static async #onDelete() {
    const item = this.#current();
    if ( !item || item.builtin ) return;
    const ok = await DialogV2.confirm({window: {title: "Delete"}, content: `<p>Delete <strong>${foundry.utils.escapeHTML(item.name)}</strong>?</p>`});
    if ( !ok ) return;
    await Library.delete(this.#tab, item.id);
    State.select(this.#tab, null);
    this.#draft[this.#tab] = null;
    this.render();
  }

  static #onRandomSeed() {
    const item = this.#current();
    if ( !item ) return;
    item.seed = Math.floor(Math.random() * 99999);
    this.#dirty[this.#tab] = true;
    this.render();
  }

  static #onPalette(_event, target) {
    const item = this.#current();
    const colors = PALETTE_PRESETS[target.dataset.palette];
    if ( !item || !colors ) return;
    item.palette = [...colors];
    this.#dirty[this.#tab] = true;
    this.render();
  }

  /** Particles: the place tool spawns the edited look where you click. */
  static #onSpawnTool() {
    State.useDraft("particles", this.#current("particles"));
    game.modules.get(HUB_ID)?.api.activateTool("kpePlace");
    collapseFor("kpePlace", this);
    ui.notifications.info("KPE.Info.ClickToPlace", {localize: true});
  }

  static async #onAttachAura() {
    const tokens = selectedTokens();
    if ( !tokens.length ) return ui.notifications.warn("KPE.Warn.SelectTokens", {localize: true});
    await this.api.attachAura(tokens, this.#current("particles"));
  }

  static async #onRemoveAuras() {
    const tokens = selectedTokens();
    if ( !tokens.length ) return ui.notifications.warn("KPE.Warn.SelectTokens", {localize: true});
    await this.api.removeAuras(tokens);
  }

  static async #onBake() {
    const path = await bake(this.#current("particles"));
    ui.notifications.info(game.i18n.format("KPE.Info.Baked", {path}));
  }

  static async #onAttachEmitter() {
    const tokens = selectedTokens();
    if ( !tokens.length ) return ui.notifications.warn("KPE.Warn.SelectTokens", {localize: true});
    await this.api.addEmitter(tokens, this.#current("emitters"));
  }

  static async #onRemoveEmitters() {
    const tokens = selectedTokens();
    if ( !tokens.length ) return ui.notifications.warn("KPE.Warn.SelectTokens", {localize: true});
    await this.api.removeEmitters(tokens);
  }

  static #onPlaceEmitter() {
    State.useDraft("emitters", this.#current("emitters"));
    game.modules.get(HUB_ID)?.api.activateTool("kpeEmitter");
    collapseFor("kpeEmitter", this);
    ui.notifications.info("KPE.Info.ClickToPlace", {localize: true});
  }

  static #onBurst() {
    const t = selectedTokens()[0];
    const point = t ? t.center : {x: canvas.stage.pivot.x, y: canvas.stage.pivot.y};
    this.api.burst(this.#current("emitters"), point, {source: t?.document.getFlag(MODULE_ID, "particle")?.preset});
  }

  static async #onUndo() {
    await game.modules.get(HUB_ID)?.api?.history?.undo();
    this.render();
  }

  static #onOpenManager() {
    this.api.openManager();
  }

  static #onWallPalette(_event, target) {
    const item = this.#current("walls");
    const colors = PALETTE_PRESETS[target.dataset.palette];
    if ( !item || !colors ) return;
    item.look.palette = [...colors];
    this.#dirty.walls = true;
    this.render();
  }

  /** Draw a new wall in this style with the animator's tools. */
  static async #onDrawWall() {
    const item = this.#current("walls");
    if ( !item ) return;
    const preset = item.builtin && !this.#dirty.walls ? item.id : item;
    const wall = await game.modules.get(MODULE_ID).api.walls.draw(preset, {tool: this.#wallTool});
    if ( wall ) collapseUntilDrawn(this, wall.source.animId);
  }

  static #onOpenWalls() {
    this.api.openWalls();
  }

  static async #onCast() {
    const effect = this.#current("effects");
    if ( !effect ) return;
    if ( effect.spawnAt === "point" ) {
      State.useDraft("effects", effect);
      game.modules.get(HUB_ID)?.api.activateTool("kpeCast");
      collapseFor("kpeCast", this);
      ui.notifications.info("KPE.Info.ClickToCast", {localize: true});
      return;
    }
    await this.api.cast(effect);
  }
}
