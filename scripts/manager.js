// The Particle Manager: every particle on the scene (and every token wearing an aura or an emitter) in one list,
// with a full editor for the selection: its look (edited live on the map), token settings and light, attached
// auras and emitters, its animator motion, and how long it lasts.

import {ANIMATOR_ID, DEL, FLAG_AURAS, FLAG_EMITTERS, FLAG_PARTICLE, FLAG_SPAWN, HUB_ID, MODULE_ID, MODULE_TITLE, NO_HISTORY} from "./const.js";
import {KINDS} from "./shader.js";
import {LOOK_FIELDS, PALETTE_PRESETS, normalizePreset} from "./presets.js";
import {normalizeAura} from "./auras.js";
import {Library} from "./library.js";
import {ParticleTokens} from "./tokens.js";
import {bake, thumbnail} from "./textures.js";
import {Preview} from "./preview.js";
import {selectedTokens} from "./selection.js";
import {CONTROL_MODES, controlOf, setControl} from "./ownership.js";
import {copies, recreate, remember, removeTokens, restore, snapshot} from "./undo.js";
import {MoldControls, outlineToolsContext} from "./outline-editor.js";
import {particleToSeal} from "./seal.js";
import {ChoiceGuard, collapseFor, finishMapWork, rememberPosition, savePosition, savedPosition} from "./window-ui.js";

const L = (key, data) => (data ? game.i18n.format(`KPE.Undo.${key}`, data) : game.i18n.localize(`KPE.Undo.${key}`));
/** Token fields each setting changes (for undo). */
const TOKEN_FIELDS = {
  size: ["width", "height", "x", "y"], lightRadius: ["light"], lightAlpha: ["light"], lightColor: ["light"], lightAnimation: ["light"]
};

const {ApplicationV2, HandlebarsApplicationMixin, DialogV2} = foundry.applications.api;

const LOOK_GROUPS = [
  {label: "Shape", keys: ["size", "shape"]},
  {label: "Pattern", keys: ["scale", "detail", "warp", "veins"]},
  {label: "Motion", keys: ["swirl", "spin", "pulse", "pulseRate"]},
  {label: "Light", keys: ["glow", "core", "rim", "sparkle", "alpha"]}
];
const LIGHT_ANIMATIONS = ["none", "pulse", "torch", "flame", "wave", "fog", "energy"];
const FILTERS = {
  all: {label: "All", icon: "fa-solid fa-layer-group"},
  particles: {label: "Particles", icon: "fa-solid fa-circle-nodes"},
  decorated: {label: "With auras or emitters", icon: "fa-solid fa-sun"},
  moving: {label: "Animated", icon: "fa-solid fa-route"},
  spawned: {label: "From casts", icon: "fa-solid fa-wand-magic-sparkles"}
};
const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(step >= 0.1 ? 1 : 2));
const kaa = () => (game.modules.get(ANIMATOR_ID)?.active ? game.modules.get(ANIMATOR_ID).api : null);

export class ParticleManager extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "kpe-manager",
    classes: ["kfp-app", "kpe-studio", "kpe-manager"],
    window: {title: `${MODULE_TITLE}: Scene particles`, icon: "fa-solid fa-list-check", resizable: true},
    position: {width: 960, height: 700},
    actions: {
      switchTab: ParticleManager.#onTab,
      pickFilter: ParticleManager.#onFilter,
      pickRow: ParticleManager.#onRow,
      selectAll: ParticleManager.#onSelectAll,
      selectNone: ParticleManager.#onSelectNone,
      openStudio: ParticleManager.#onStudio,
      placeNew: ParticleManager.#onPlaceNew,
      clearScene: ParticleManager.#onClearScene,
      usePalette: ParticleManager.#onPalette,
      randomSeed: ParticleManager.#onSeed,
      loadPreset: ParticleManager.#onLoadPreset,
      applyLook: ParticleManager.#onApplyLook,
      revertLook: ParticleManager.#onRevertLook,
      saveLook: ParticleManager.#onSaveLook,
      addAura: ParticleManager.#onAddAura,
      removeAura: ParticleManager.#onRemoveAura,
      addEmitter: ParticleManager.#onAddEmitter,
      removeEmitter: ParticleManager.#onRemoveEmitter,
      motionPause: ParticleManager.#onMotionPause,
      motionStop: ParticleManager.#onMotionStop,
      motionReturn: ParticleManager.#onMotionReturn,
      applyTemplate: ParticleManager.#onApplyTemplate,
      playAnimation: ParticleManager.#onPlayAnimation,
      openAnimator: ParticleManager.#onOpenAnimator,
      setLifetime: ParticleManager.#onSetLifetime,
      controlSelected: ParticleManager.#onControl,
      panTo: ParticleManager.#onPan,
      duplicate: ParticleManager.#onDuplicate,
      toggleHidden: ParticleManager.#onToggleHidden,
      deleteSelected: ParticleManager.#onDelete,
      undo: ParticleManager.#onUndo,
      moldToggle: ParticleManager.#onMold,
      moldDraw: ParticleManager.#onMold,
      moldSharp: ParticleManager.#onMold,
      moldRound: ParticleManager.#onMold,
      moldMirror: ParticleManager.#onMold,
      moldReset: ParticleManager.#onMold,
      makeSeal: ParticleManager.#onMakeSeal
    }
  };

  static PARTS = {
    main: {template: `modules/${MODULE_ID}/templates/manager.hbs`, scrollable: [".kpm-list", ".kpe-editor-scroll"]}
  };

  /**
   * Open the manager (optionally focused on some tokens).
   * @param {object} [options]
   * @param {string[]} [options.tokens]
   * @param {string} [options.tab]
   */
  static open({tokens, tab}={}) {
    this.#instance ??= new this({position: savedPosition(this.DEFAULT_OPTIONS.id)});
    if ( tokens?.length ) this.#instance.select(tokens);
    if ( tab ) this.#instance.#tab = tab;
    this.#instance.render({force: true});
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  static get instance() {
    return this.#instance;
  }

  #tab = "look";

  #filter = "all";

  #search = "";

  /** Selected token ids (in the order they were picked). */
  #selected = [];

  /** Unsaved look for the selected particles, and the selection it belongs to. */
  #draft = null;

  #draftFor = "";

  /** Show the unsaved look on the map while editing. */
  #livePreview = true;

  /** Keep the canvas selection in step with the list. */
  #syncCanvas = true;

  /** "These players" picked but nobody ticked yet (nothing changes until someone is). */
  #controlPending = false;

  #preview = new Preview();

  #choices = new ChoiceGuard(() => this.render());

  /** Molding the selected particles' outline by hand, over the preview (shown live on the map). */
  #mold = new MoldControls({
    get: () => this.#lookDraft()?.outline ?? null,
    set: (outline, final) => this.#setOutline(outline, final)
  });

  /** Ignore our own canvas selection changes. */
  #controlling = false;

  /** Template / animation choices in the Motion tab. */
  #motion = {template: "", animation: ""};

  /* -------------------------------------------- */
  /*  Selection                                   */
  /* -------------------------------------------- */

  get scene() {
    return canvas.scene;
  }

  /** Tokens this manager lists. */
  #listed() {
    const scene = this.scene;
    if ( !scene ) return [];
    // Players see what they control
    return scene.tokens.filter(t => (t.getFlag(MODULE_ID, FLAG_PARTICLE) || !foundry.utils.isEmpty(t.getFlag(MODULE_ID, FLAG_AURAS) ?? {})
      || !foundry.utils.isEmpty(t.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {})) && (game.user.isGM || t.isOwner));
  }

  #docs() {
    return this.#selected.map(id => this.scene?.tokens.get(id)).filter(Boolean);
  }

  #particles() {
    return this.#docs().filter(d => d.getFlag(MODULE_ID, FLAG_PARTICLE));
  }

  /** Select tokens in the list (and on the canvas). */
  select(ids, {add=false}={}) {
    const before = this.#selected.join(",");
    this.#selected = add ? [...new Set([...this.#selected, ...ids])] : [...new Set(ids)];
    if ( this.#selected.join(",") !== before ) this.#dropDraft();
    if ( this.#syncCanvas && canvas.ready ) this.#controlOnCanvas();
  }

  /**
   * Select the chosen tokens on the map. Foundry only lets tokens be selected while the token layer is active, so this
   * switches to it when asked to (the "Select on the map" button), and otherwise only follows along when it is.
   */
  #controlOnCanvas({activate=false}={}) {
    if ( !canvas.tokens?.active ) {
      if ( !activate ) return;
      canvas.tokens.activate();
    }
    this.#controlling = true;
    try {
      canvas.tokens.releaseAll?.();
      for ( const d of this.#docs() ) d.object?.control({releaseOthers: false});
    } finally {
      this.#controlling = false;
    }
  }

  /** The canvas selection changed (outside this window). */
  onCanvasControl() {
    if ( this.#controlling || !this.#syncCanvas ) return;
    const listed = new Set(this.#listed().map(d => d.id));
    const picked = selectedTokens().map(t => t.id).filter(id => listed.has(id));
    if ( picked.length ) {
      const before = this.#selected.join(",");
      this.#selected = picked;
      if ( picked.join(",") !== before ) this.#dropDraft();
    }
    this.render();
  }

  /** Forget the unsaved look (and stop showing it on the map). */
  #dropDraft() {
    if ( this.#draft ) ParticleTokens.previewLook(ParticleTokens.previewing, null);
    this.#draft = null;
    this.#draftFor = "";
  }

  #lookDraft() {
    const parts = this.#particles();
    if ( !parts.length ) return null;
    const key = parts.map(d => d.id).join(",");
    if ( !this.#draft || (this.#draftFor !== key) ) {
      this.#draft = normalizePreset(parts[0].getFlag(MODULE_ID, FLAG_PARTICLE).preset);
      this.#draftFor = key;
      this.#draft._dirty = false;
    }
    return this.#draft;
  }

  #setDraft(preset) {
    const dirty = true;
    this.#draft = Object.assign(normalizePreset(preset), {_dirty: dirty});
    this.#draftFor = this.#particles().map(d => d.id).join(",");
    if ( this.#livePreview ) ParticleTokens.previewLook(this.#particles().map(d => d.id), this.#draft);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options) {
    const scene = this.scene;
    const ctx = {scene: !!scene, filters: [], rows: [], isGM: game.user.isGM, animator: !!kaa(),
      undo: game.modules.get(HUB_ID)?.api?.history?.peek()?.label ?? null};
    if ( !scene ) return ctx;
    if ( !this.#preview.app ) this.#preview.mount(document.createElement("div"));
    const grid = scene.dimensions.size;
    const now = game.time.serverTime;
    const api = kaa();
    const listed = this.#listed();
    // Keep the selection to tokens that still exist
    this.#selected = this.#selected.filter(id => listed.some(d => d.id === id));

    const describe = d => {
      const p = d.getFlag(MODULE_ID, FLAG_PARTICLE)?.preset;
      const preset = p ? normalizePreset(p) : null;
      const spawn = d.getFlag(MODULE_ID, FLAG_SPAWN);
      const status = api?.status(d) ?? {playing: false};
      const auras = Object.keys(d.getFlag(MODULE_ID, FLAG_AURAS) ?? {}).length;
      const emitters = Object.keys(d.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {}).length;
      let life = null;
      if ( spawn?.lifetime === "timed" && spawn.until ) life = `${Math.max(0, Math.ceil((spawn.until - now) / 1000))} s`;
      else if ( spawn?.lifetime === "animation" ) life = "until it lands";
      return {
        id: d.id, name: d.name, particle: !!preset, kind: preset ? KINDS[preset.kind]?.label : "Token",
        thumb: preset ? this.#thumb(preset) : (d.texture?.src ?? ""),
        size: d.width, auras, emitters, hidden: d.hidden, spawned: !!spawn, life,
        moving: status.playing, paused: status.paused, anim: status.anim?.name ?? null,
        selected: this.#selected.includes(d.id),
        search: `${d.name} ${preset?.name ?? ""} ${preset ? KINDS[preset.kind]?.label : ""}`.toLowerCase()
      };
    };
    const all = listed.map(describe);
    const pass = r => {
      if ( this.#filter === "particles" ) return r.particle;
      if ( this.#filter === "decorated" ) return r.auras || r.emitters;
      if ( this.#filter === "moving" ) return r.moving;
      if ( this.#filter === "spawned" ) return r.spawned;
      return true;
    };
    const q = this.#search.trim().toLowerCase();
    ctx.rows = all.filter(pass).map(r => ({...r, hidden2: !!q && !r.search.includes(q)}));
    ctx.filters = Object.entries(FILTERS).map(([key, f]) => ({key, ...f, active: key === this.#filter, count: all.filter(r => {
      if ( key === "particles" ) return r.particle;
      if ( key === "decorated" ) return r.auras || r.emitters;
      if ( key === "moving" ) return r.moving;
      if ( key === "spawned" ) return r.spawned;
      return true;
    }).length}));
    ctx.search = this.#search;
    ctx.total = all.length;
    ctx.sceneEmitters = Object.keys(scene.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {}).length;

    // Editor for the selection
    const docs = this.#docs();
    ctx.count = docs.length;
    ctx.many = docs.length > 1;
    ctx.liveDot = this.#livePreview;
    ctx.syncCanvas = this.#syncCanvas;
    if ( !docs.length ) return ctx;
    const d0 = docs[0];
    const parts = this.#particles();
    ctx.primary = {id: d0.id, name: d0.name};
    ctx.tabs = [
      {key: "look", label: "Look", icon: "fa-solid fa-palette", disabled: !parts.length},
      {key: "token", label: "Token", icon: "fa-solid fa-user"},
      {key: "attach", label: "Auras & emitters", icon: "fa-solid fa-sun"},
      {key: "motion", label: "Motion", icon: "fa-solid fa-route"},
      {key: "life", label: "Lifetime", icon: "fa-solid fa-hourglass-half", disabled: !parts.length}
    ];
    // Looks and lifetimes are for particles only (a hero wearing an aura must never get a despawn timer)
    if ( ["look", "life"].includes(this.#tab) && !parts.length ) this.#tab = "token";
    for ( const t of ctx.tabs ) t.active = t.key === this.#tab;
    ctx.tab = this.#tab;

    // Look
    const draft = this.#lookDraft();
    if ( draft ) {
      ctx.look = {
        draft, dirty: !!draft._dirty, particles: parts.length,
        kinds: Object.entries(KINDS).map(([k, v]) => ({value: k, label: v.label, selected: k === draft.kind})),
        palette: draft.palette.map((c, i) => ({i, value: c})),
        palettes: Object.entries(PALETTE_PRESETS).map(([key, colors]) => ({key, gradient: `linear-gradient(90deg, ${colors.join(", ")})`})),
        outline: outlineToolsContext(draft.outline, this.#mold.molding),
        // A rune circle can become a seal: an effect wall in its look, stretched over a room (walls are the GM's)
        canSeal: game.user.isGM && !!kaa() && (parts.length === 1) && (draft.kind === "rune"),
        groups: LOOK_GROUPS.map(g => ({label: g.label, fields: g.keys.map(k => {
          const f = LOOK_FIELDS[k];
          return {key: `look.${k}`, label: f.label, min: f.min, max: f.max, step: f.step, value: draft.look[k], text: fmt(draft.look[k], f.step)};
        })})),
        presets: Library.all("particles").map(p => ({value: p.id, label: `${p.name}${p.builtin ? "" : " ★"}`}))
      };
    }

    // Token
    const light = d0.light ?? {};
    const distance = scene.dimensions.distance || 1;
    ctx.token = {
      name: d0.name, size: d0.width, alpha: d0.alpha ?? 1, elevation: d0.elevation ?? 0, rotation: Math.round(d0.rotation ?? 0),
      lockRotation: !!d0.lockRotation, hidden: !!d0.hidden,
      dispositions: [[-1, "Hostile"], [0, "Neutral"], [1, "Friendly"], [-2, "Secret"]]
        .map(([v, label]) => ({value: v, label, selected: v === d0.disposition})),
      lightRadius: Math.round(((light.dim ?? 0) / distance) * 100) / 100,
      lightAlpha: Math.round((light.alpha ?? 0.5) * 100) / 100,
      lightColor: light.color ? String(light.color) : (parts[0] ? normalizePreset(parts[0].getFlag(MODULE_ID, FLAG_PARTICLE).preset).palette[2] : "#ffffff"),
      lightAnimations: LIGHT_ANIMATIONS.map(v => ({value: v, label: v, selected: (light.animation?.type ?? "none") === v || (!light.animation?.type && v === "none")}))
    };

    // Who controls them (GM, particles only)
    if ( game.user.isGM && parts.length ) {
      const control = controlOf(parts[0]);
      const mode = this.#controlPending ? "players" : control.mode;
      ctx.control = {
        modes: Object.entries(CONTROL_MODES).map(([value, label]) => ({value, label, selected: value === mode})),
        chosen: mode === "players",
        players: game.users.filter(u => !u.isGM).map(u => ({id: u.id, name: u.name, checked: control.users.includes(u.id)})),
        mixed: parts.some(d => JSON.stringify(controlOf(d)) !== JSON.stringify(control))
      };
    }

    // Attachments (of the first selected token)
    const aurasF = d0.getFlag(MODULE_ID, FLAG_AURAS) ?? {};
    const emittersF = d0.getFlag(MODULE_ID, FLAG_EMITTERS) ?? {};
    ctx.attach = {
      auras: Object.entries(aurasF).filter(([, a]) => a).map(([id, a]) => {
        const n = normalizeAura(a);
        return {id, name: n.preset?.name ?? "?", scale: n.scale, below: n.below, alpha: n.alpha, spin: n.spin, thumb: n.preset ? this.#thumb(n.preset) : ""};
      }),
      emitters: Object.entries(emittersF).filter(([, e]) => e).map(([id, e]) => ({id, name: Library.get("emitters", e.emitter)?.name ?? "?"})),
      auraOptions: Library.all("particles").filter(p => ["aura", "rune", "bubble", "vortex", "orb", "mote"].includes(p.kind))
        .map(p => ({value: p.id, label: `${p.name}${p.builtin ? "" : " ★"}`})),
      emitterOptions: Library.all("emitters").filter(e => !e.oneShot).map(e => ({value: e.id, label: `${e.name}${e.builtin ? "" : " ★"}`}))
    };

    // Motion
    const st = api?.status(d0) ?? {playing: false};
    ctx.motion = {
      playing: st.playing, paused: st.paused, anim: st.anim?.name ?? null, animId: st.anim?.id ?? null,
      progress: st.progress != null ? Math.round(st.progress * 100) : null, rate: st.rate ?? 1, copies: st.copies ?? 0,
      templates: (api?.templates() ?? []).map(t => ({value: t.id, label: `${t.category === "attacks" ? "⚔ " : ""}${t.name}`, selected: t.id === this.#motion.template})),
      animations: (api?.animations(scene) ?? []).map(a => ({value: a.id, label: a.name, selected: a.id === this.#motion.animation})),
      targets: game.user.targets.size
    };

    // Lifetime
    const spawn = parts[0]?.getFlag(MODULE_ID, FLAG_SPAWN);
    ctx.life = {
      mode: spawn?.lifetime ?? "forever",
      remaining: spawn?.lifetime === "timed" && spawn.until ? Math.max(0, Math.ceil((spawn.until - now) / 1000)) : null,
      seconds: spawn?.lifetime === "timed" && spawn.until ? Math.max(1, Math.ceil((spawn.until - now) / 1000)) : 60
    };
    ctx.grid = grid;
    return ctx;
  }

  #thumb(preset) {
    try {
      return thumbnail(preset, 64, this.#preview.renderer ?? undefined);
    } catch(err) {
      return "";
    }
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element.querySelector("[data-preview]");
    if ( el ) {
      this.#preview.mount(el);
      if ( this.#draft ) this.#preview.showParticle(this.#draft);
    }
    this.#mold.attach((this.#tab === "look") && context.look ? el : null);
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
    this.#dropDraft();
    this.#mold.destroy();
    this.#preview.destroy();
    ParticleManager.#instance = null;
  }

  /* -------------------------------------------- */
  /*  Form input                                  */
  /* -------------------------------------------- */

  #onInput(event) {
    const el = event.target;
    if ( el.name === "search" ) {
      this.#search = el.value;
      const q = el.value.trim().toLowerCase();
      for ( const row of this.element.querySelectorAll(".kpm-row") ) row.hidden = !!q && !row.dataset.search.includes(q);
      return;
    }
    if ( el.name?.startsWith("look.") || el.name?.startsWith("palette.") ) {
      this.#editLook(el);
      const out = el.closest(".kfp-range")?.querySelector("output");
      if ( out ) out.textContent = fmt(Number(el.value), Number(el.step) || 1);
      const bar = this.element.querySelector(".kpm-apply");
      bar?.classList.add("kpm-dirty");
      for ( const btn of bar?.querySelectorAll("button[disabled]") ?? [] ) btn.disabled = false;
    }
  }

  #editLook(el) {
    const draft = this.#lookDraft();
    if ( !draft ) return;
    const next = foundry.utils.deepClone(draft);
    if ( el.name.startsWith("palette.") ) next.palette[Number(el.name.slice(8))] = el.value;
    else next.look[el.name.slice(5)] = Number(el.value);
    this.#setDraft(next);
    this.#preview.showParticle(this.#draft);
  }

  async #onChange(event) {
    const el = event.target;
    const name = el.name;
    if ( !name || (name === "search") ) return;
    if ( (el.type === "range") && (name.startsWith("look.") || name.startsWith("palette.")) ) return;
    const value = el.type === "checkbox" ? el.checked : ((el.type === "number") || (el.type === "range") ? Number(el.value) : el.value);
    if ( name === "moldShape" ) {
      if ( value ) this.#mold.shape(value);
      return;
    }
    if ( name === "kind" ) {
      const draft = this.#lookDraft();
      this.#setDraft({...draft, kind: value, look: undefined});
      return this.render();
    }
    if ( name.startsWith("palette.") ) return;
    if ( name === "livePreview" ) {
      this.#livePreview = value;
      ParticleTokens.previewLook(this.#particles().map(d => d.id), value && this.#draft?._dirty ? this.#draft : null);
      return;
    }
    if ( name === "syncCanvas" ) {
      this.#syncCanvas = value;
      return;
    }
    if ( name.startsWith("motion.") ) {
      this.#motion[name.slice(7)] = value;
      return;
    }
    if ( name === "motionRate" ) {
      await kaa()?.setRate(this.#selected, value);
      return this.render();
    }
    if ( name.startsWith("token.") ) return this.#editToken(name.slice(6), value);
    if ( name.startsWith("control.") ) return this.#editControl(name.slice(8), value);
    if ( name.startsWith("aura.") ) {
      const [, id, key] = name.split(".");
      const d0 = this.#docs()[0];
      const cur = d0?.getFlag(MODULE_ID, FLAG_AURAS)?.[id];
      if ( cur ) {
        const before = snapshot([d0]);
        await d0.update({flags: {[MODULE_ID]: {[FLAG_AURAS]: {[id]: {...cur, [key]: value}}}}}, {[NO_HISTORY]: true});
        remember(L("EditAura"), () => restore(this.scene, before), this.scene);
      }
      return this.render();
    }
  }

  /** A new outline for the selected particles (shown live; Apply makes it permanent). */
  #setOutline(outline, final) {
    const draft = this.#lookDraft();
    if ( !draft ) return;
    this.#setDraft({...foundry.utils.deepClone(draft), outline});
    this.#preview.showParticle(this.#draft);
    const bar = this.element?.querySelector(".kpm-apply");
    bar?.classList.add("kpm-dirty");
    for ( const btn of bar?.querySelectorAll("button[disabled]") ?? [] ) btn.disabled = false;
    if ( final ) this.render();
  }

  /** Who controls the selected particles (GM). */
  async #editControl(key, value) {
    const parts = this.#particles();
    if ( !game.user.isGM || !parts.length ) return;
    let spec;
    if ( key === "mode" ) {
      // "These players": wait until someone is ticked
      this.#controlPending = value === "players";
      if ( value === "players" ) return this.render();
      spec = value;
    } else if ( key.startsWith("user.") ) {
      const current = controlOf(parts[0]);
      const users = new Set(this.#controlPending || (current.mode === "players") ? current.users : []);
      if ( value ) users.add(key.slice(5));
      else users.delete(key.slice(5));
      spec = [...users];
    } else return;
    this.#controlPending = false;
    const scene = this.scene;
    const undo = await setControl(scene, parts, spec);
    if ( undo ) remember(L("Control", {count: parts.length}), undo, scene);
    else ui.notifications.warn("KPE.Warn.NoParticleActor", {localize: true});
    this.render();
  }

  /** Token settings apply to every selected token. */
  async #editToken(key, value) {
    const docs = this.#docs();
    const scene = this.scene;
    if ( !docs.length ) return;
    const grid = scene.dimensions.size;
    const distance = scene.dimensions.distance || 1;
    const updates = docs.map(d => {
      const u = {_id: d.id};
      switch ( key ) {
        case "size": {
          const s = Math.max(0.1, Math.min(100, value));
          const cx = d.x + ((d.width * grid) / 2);
          const cy = d.y + ((d.height * grid) / 2);
          Object.assign(u, {width: s, height: s, x: cx - ((s * grid) / 2), y: cy - ((s * grid) / 2)});
          break;
        }
        case "lightRadius":
          Object.assign(u, {"light.dim": Math.max(0, value) * distance, "light.bright": Math.max(0, value) * distance * 0.35});
          break;
        case "lightAlpha": u["light.alpha"] = Math.max(0, Math.min(1, value)); break;
        case "lightColor": u["light.color"] = value; break;
        case "lightAnimation": u["light.animation.type"] = value === "none" ? null : value; break;
        case "disposition": u.disposition = Number(value); break;
        case "name": if ( docs.length === 1 ) u.name = value; break;
        default: u[key] = value;
      }
      return u;
    });
    const before = snapshot(docs, TOKEN_FIELDS[key] ?? [key === "lightRadius" ? "light" : key]);
    await scene.updateEmbeddedDocuments("Token", updates, {animate: false, [NO_HISTORY]: true});
    remember(L("EditToken", {field: game.i18n.localize(`KPE.Manager.Field.${key}`)}), () => restore(scene, before), scene);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: list                               */
  /* -------------------------------------------- */

  static #onMold(_event, target) {
    if ( this.#mold.action(target.dataset.action) ) this.render();
  }

  /** Turn the selected rune circle into a seal you can stretch over a room (with what you see, unsaved edits included). */
  static async #onMakeSeal() {
    const parts = this.#particles();
    if ( parts.length !== 1 ) return;
    const preset = this.#draft?._dirty ? normalizePreset(this.#draft) : null;
    this.#dropDraft();
    const wall = await particleToSeal(parts[0], {preset});
    if ( wall ) this.render();
  }

  static #onTab(_event, target) {
    if ( target.disabled ) return;
    this.#tab = target.dataset.tab;
    this.render();
  }

  static #onFilter(_event, target) {
    this.#filter = target.dataset.filter;
    this.render();
  }

  static #onRow(event, target) {
    const id = target.closest("[data-token]").dataset.token;
    if ( event.shiftKey || event.ctrlKey || event.metaKey ) {
      const has = this.#selected.includes(id);
      this.select(has ? this.#selected.filter(x => x !== id) : [...this.#selected, id]);
    } else this.select([id]);
    this.render();
  }

  static #onSelectAll() {
    const ctx = this.element.querySelectorAll(".kpm-row:not([hidden])");
    this.select([...ctx].map(r => r.dataset.token));
    this.render();
  }

  static #onSelectNone() {
    this.select([]);
    this.render();
  }

  static #onStudio() {
    game.modules.get(MODULE_ID).api.openStudio();
  }

  static #onPlaceNew() {
    game.modules.get(HUB_ID)?.api.activateTool("kpePlace");
    collapseFor("kpePlace", this);
  }

  static async #onClearScene() {
    await game.modules.get(MODULE_ID).api.clearScene({confirm: true});
    this.select([]);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: look                               */
  /* -------------------------------------------- */

  static #onPalette(_event, target) {
    const draft = this.#lookDraft();
    const colors = PALETTE_PRESETS[target.dataset.palette];
    if ( !draft || !colors ) return;
    this.#setDraft({...draft, palette: [...colors]});
    this.render();
  }

  static #onSeed() {
    const draft = this.#lookDraft();
    if ( !draft ) return;
    this.#setDraft({...draft, seed: Math.floor(Math.random() * 99999)});
    this.render();
  }

  static #onLoadPreset() {
    const id = this.element.querySelector("[name='lookPreset']")?.value;
    const p = Library.get("particles", id);
    if ( !p ) return;
    this.#setDraft({...p});
    this.render();
  }

  /** Make the edited look permanent on every selected particle (for everyone). */
  static async #onApplyLook() {
    const draft = this.#draft;
    const parts = this.#particles();
    if ( !draft || !parts.length ) return;
    const preset = normalizePreset(draft);
    const src = await bake(preset);
    const follow = this.element?.querySelector("[name='lightFollows']")?.checked ?? true;
    const updates = parts.map(d => {
      const u = {_id: d.id, "texture.src": src, flags: {[MODULE_ID]: {[FLAG_PARTICLE]: {preset, variant: d.getFlag(MODULE_ID, FLAG_PARTICLE)?.variant ?? 0}}}};
      if ( follow && d.light?.dim ) u["light.color"] = preset.palette[2];
      return u;
    });
    ParticleTokens.previewLook(parts.map(d => d.id), null);
    const scene = this.scene;
    const before = snapshot(parts, ["texture.src", "light"]);
    await scene.updateEmbeddedDocuments("Token", updates, {[NO_HISTORY]: true});
    remember(L("Look", {count: parts.length}), () => restore(scene, before), scene);
    this.#draft = null;
    this.#draftFor = "";
    ui.notifications.info(game.i18n.format("KPE.Info.LookApplied", {count: parts.length}));
    this.render();
  }

  static #onRevertLook() {
    this.#dropDraft();
    this.render();
  }

  static async #onSaveLook() {
    // The library is a world setting: GMs only
    if ( !game.user.isGM ) return;
    const draft = this.#lookDraft();
    if ( !draft ) return;
    const saved = await Library.save("particles", {...draft, id: null, name: `${draft.name}${draft.builtin ? "" : " (edited)"}`}, {copy: true});
    ui.notifications.info(game.i18n.format("KPE.Info.Saved", {name: saved.name}));
  }

  /* -------------------------------------------- */
  /*  Actions: attachments                        */
  /* -------------------------------------------- */

  static async #onAddAura() {
    const id = this.element.querySelector("[name='newAura']")?.value;
    if ( !id ) return;
    await game.modules.get(MODULE_ID).api.attachAura(this.#docs(), id);
    this.render();
  }

  static async #onRemoveAura(_event, target) {
    const id = target.closest("[data-aura]").dataset.aura;
    await game.modules.get(MODULE_ID).api.removeAuras(this.#docs(), id);
    this.render();
  }

  static async #onAddEmitter() {
    const id = this.element.querySelector("[name='newEmitter']")?.value;
    if ( !id ) return;
    await game.modules.get(MODULE_ID).api.addEmitter(this.#docs(), id);
    this.render();
  }

  static async #onRemoveEmitter(_event, target) {
    const id = target.closest("[data-emitter]").dataset.emitter;
    await game.modules.get(MODULE_ID).api.removeEmitters(this.#docs(), id);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: motion                             */
  /* -------------------------------------------- */

  static async #onMotionPause() {
    await kaa()?.togglePause(this.#selected);
    this.render();
  }

  static async #onMotionStop() {
    await kaa()?.stop(this.#selected, {mode: "here"});
    this.render();
  }

  static async #onMotionReturn() {
    await kaa()?.stop(this.#selected, {mode: "origin"});
    this.render();
  }

  static async #onApplyTemplate() {
    const api = kaa();
    const id = this.#motion.template || this.element.querySelector("[name='motion.template']")?.value;
    if ( !api || !id ) return;
    await api.applyTemplate(id, this.#selected, {scene: this.scene.id});
    this.render();
  }

  static async #onPlayAnimation() {
    const api = kaa();
    const id = this.#motion.animation || this.element.querySelector("[name='motion.animation']")?.value;
    if ( !api || !id ) return;
    await api.play(id, this.#selected);
    this.render();
  }

  static #onOpenAnimator() {
    const api = kaa();
    const animId = api?.status(this.#docs()[0])?.anim?.id;
    api?.openPanel(animId ? {animId} : {});
  }

  /* -------------------------------------------- */
  /*  Actions: lifetime                           */
  /* -------------------------------------------- */

  static async #onSetLifetime(_event, target) {
    const mode = target.dataset.mode;
    const seconds = Number(this.element.querySelector("[name='lifeSeconds']")?.value) || 60;
    const now = game.time.serverTime;
    const parts = this.#particles();
    if ( !parts.length ) return;
    const updates = parts.map(d => {
      const cur = d.getFlag(MODULE_ID, FLAG_SPAWN) ?? {};
      if ( mode === "forever" ) return {_id: d.id, flags: {[MODULE_ID]: {[FLAG_SPAWN]: cur.cast ? {...cur, lifetime: "forever", until: null} : DEL()}}};
      return {_id: d.id, flags: {[MODULE_ID]: {[FLAG_SPAWN]: {...cur, cast: cur.cast ?? foundry.utils.randomID(10), lifetime: "timed", until: now + (seconds * 1000)}}}};
    });
    const scene = this.scene;
    const before = snapshot(parts);
    await scene.updateEmbeddedDocuments("Token", updates, {[NO_HISTORY]: true});
    remember(L("Lifetime"), () => restore(scene, before), scene);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions: selection                          */
  /* -------------------------------------------- */

  static async #onUndo() {
    await game.modules.get(HUB_ID)?.api?.history?.undo();
    this.render();
  }

  static #onControl() {
    this.#controlOnCanvas({activate: true});
  }

  static #onPan() {
    const docs = this.#docs();
    if ( !docs.length ) return;
    const g = this.scene.dimensions.size;
    const xs = docs.map(d => d.x + ((d.width * g) / 2));
    const ys = docs.map(d => d.y + ((d.height * g) / 2));
    canvas.animatePan({x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, duration: 300});
  }

  static async #onDuplicate() {
    if ( !game.user.isGM ) return;
    // Only particles are copied (copying a character token is a job for Foundry's own tools)
    const docs = this.#particles();
    if ( !docs.length ) return;
    const g = this.scene.dimensions.size;
    const data = docs.map(d => {
      const o = d.toObject();
      delete o._id;
      o.x += g * 0.5;
      o.y += g * 0.5;
      // A copy starts still and outside any running animation or cast
      if ( o.flags?.[ANIMATOR_ID] ) delete o.flags[ANIMATOR_ID];
      return o;
    });
    const scene = this.scene;
    const made = await scene.createEmbeddedDocuments("Token", data, {[NO_HISTORY]: true});
    const ids = made.map(d => d.id);
    remember(L("Duplicate", {count: ids.length}), () => removeTokens(scene, ids), scene);
    this.select(ids);
    this.render();
  }

  static async #onToggleHidden() {
    const docs = this.#docs();
    const hide = !docs.every(d => d.hidden);
    const scene = this.scene;
    const before = snapshot(docs, ["hidden"]);
    await scene.updateEmbeddedDocuments("Token", docs.map(d => ({_id: d.id, hidden: hide})), {[NO_HISTORY]: true});
    remember(L(hide ? "Hide" : "Show", {count: docs.length}), () => restore(scene, before), scene);
    this.render();
  }

  static async #onDelete() {
    const docs = this.#docs();
    if ( !docs.length ) return;
    const ok = await DialogV2.confirm({window: {title: "Delete"},
      content: `<p>Delete ${docs.length === 1 ? `<strong>${foundry.utils.escapeHTML(docs[0].name)}</strong>` : `${docs.length} tokens`}?</p>`});
    if ( !ok ) return;
    // Particles go; other tokens only lose their auras and emitters
    const scene = this.scene;
    const particles = docs.filter(d => d.getFlag(MODULE_ID, FLAG_PARTICLE));
    const others = docs.filter(d => !d.getFlag(MODULE_ID, FLAG_PARTICLE));
    const saved = copies(particles);
    const before = snapshot(others);
    if ( particles.length ) await removeTokens(scene, particles.map(d => d.id));
    if ( others.length ) {
      await scene.updateEmbeddedDocuments("Token", others.map(d => ({_id: d.id, flags: {[MODULE_ID]: {[FLAG_AURAS]: DEL(), [FLAG_EMITTERS]: DEL()}}})),
        {[NO_HISTORY]: true});
    }
    remember(L("Delete", {count: docs.length}), async () => {
      await recreate(scene, saved);
      await restore(scene, before);
    }, scene);
    this.select([]);
    this.render();
  }
}
