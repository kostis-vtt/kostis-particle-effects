// Tests for Kostis's Particle Effects (Foundry, PIXI and the animator are mocked; the hub module is real).
import {pathToFileURL, fileURLToPath} from "node:url";
import {dirname} from "node:path";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
// Foundry's own files (Handlebars, PIXI, its stylesheets) come from a local install: set FOUNDRY_APP if it lives elsewhere
const FOUNDRY_APP = (process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app").replace(/\\/g, "/");
const Handlebars = require(`${FOUNDRY_APP}/node_modules/handlebars`);

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) + "/";
const MODS = dirname(ROOT) + "/";
const MOD = "kostis-particle-effects";
const KAA = "kostis-actual-animator";
let fails = 0;
const ok = (c, m) => { if ( !c ) { fails++; console.log("FAIL:", m); } else console.log("ok  :", m); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const imp = f => import(pathToFileURL(ROOT + "scripts/" + f).href);
const flush = () => new Promise(r => setTimeout(r, 5));

/* ---------------- Utils ---------------- */
class ForcedDeletion {}
class Replace { constructor(v) { this.v = v; } }
globalThis._replace = v => new Replace(v);
const isDel = v => v instanceof ForcedDeletion;
const isRep = v => v instanceof Replace;
function expand(obj) {
  const out = {};
  for ( const [k, v] of Object.entries(obj) ) {
    const parts = k.split(".");
    let cur = out;
    for ( let i = 0; i < parts.length - 1; i++ ) cur = (cur[parts[i]] ??= {});
    const last = parts.at(-1);
    const plain = v && typeof v === "object" && !Array.isArray(v) && !isDel(v) && !isRep(v);
    cur[last] = (plain && cur[last] && typeof cur[last] === "object") ? {...cur[last], ...expand(v)} : (plain ? expand(v) : v);
  }
  return out;
}
function merge(target, changes) {
  for ( const [k, v] of Object.entries(changes) ) {
    if ( isDel(v) ) delete target[k];
    else if ( v && typeof v === "object" && !Array.isArray(v) ) {
      if ( !target[k] || typeof target[k] !== "object" ) target[k] = {};
      merge(target[k], v);
    } else target[k] = v;
  }
}
const clone = o => JSON.parse(JSON.stringify(o, (k, v) => (isDel(v) ? undefined : (isRep(v) ? v.v : v))));
/** Apply update data the way Foundry does: nested merge, ForcedDeletion and ForcedReplacement. */
function applyOps(target, ch) {
  for ( const [k, v] of Object.entries(ch) ) {
    if ( isDel(v) ) delete target[k];
    else if ( isRep(v) ) target[k] = clone(v.v);
    else if ( v && typeof v === "object" && !Array.isArray(v) ) {
      if ( !target[k] || typeof target[k] !== "object" ) target[k] = {};
      applyOps(target[k], v);
    } else target[k] = v;
  }
}
const getProp = (o, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const setProp = (o, path, v) => { const p = path.split("."); let c = o; for ( let i = 0; i < p.length - 1; i++ ) c = (c[p[i]] ??= {}); c[p.at(-1)] = v; };

/* ---------------- Hooks ---------------- */
const hooks = {};
let hookSerial = 0;
const hookIds = new Map();
globalThis.Hooks = {
  on: (n, f) => { (hooks[n] ??= []).push(f); hookIds.set(++hookSerial, f); return hookSerial; },
  off: (n, idOrFn) => { const f = typeof idOrFn === "function" ? idOrFn : hookIds.get(idOrFn); hooks[n] = (hooks[n] ?? []).filter(x => x !== f); },
  once: (n, f) => (hooks[n] ??= []).push(f),
  callAll: (n, ...a) => { for ( const f of hooks[n] ?? [] ) f(...a); }, call: (n, ...a) => { for ( const f of hooks[n] ?? [] ) f(...a); return true; }
};

/* ---------------- PIXI ---------------- */
class Display {
  constructor() {
    const pt = () => ({x: 0, y: 0, set(x, y = x) { this.x = x; this.y = y; }});
    this.children = []; this.position = pt(); this.scale = pt(); this.anchor = pt(); this.alpha = 1; this.visible = true; this.angle = 0; this.destroyed = false;
  }
  addChild(c) { this.children.push(c); c.parent = this; return c; }
  removeChildren() { const c = this.children; this.children = []; return c; }
  destroy() { this.destroyed = true; if ( this.parent ) this.parent.children = this.parent.children.filter(c => c !== this); }
}
let renders = 0;
class RT { constructor(w, h) { this.width = w; this.height = h; this.valid = true; this.baseTexture = {destroyed: false}; } destroy() { this.baseTexture.destroyed = true; this.valid = false; } }
const fakeCanvasEl = () => ({toBlob: (cb, type) => cb(new Blob(["x"], {type})), toDataURL: () => "data:image/webp;base64,AAAA"});
const renderer = {render: () => { renders++; }, extract: {canvas: () => fakeCanvasEl()}};
const tickerFns = [];
globalThis.PIXI = {
  Container: Display,
  Graphics: class extends Display {
    ops = [];
    beginFill() { return this; } endFill() { return this; } lineStyle() { return this; }
    drawRect(...a) { this.ops.push(["rect", ...a]); return this; } drawCircle(...a) { this.ops.push(["circle", ...a]); return this; }
    moveTo(...a) { this.ops.push(["move", ...a]); return this; } lineTo(...a) { this.ops.push(["line", ...a]); return this; } closePath() { return this; }
    clear() { this.ops = []; return this; }
  },
  Sprite: class extends Display { constructor(t) { super(); this.texture = t; this.width = 1; this.height = 1; } },
  Geometry: class { addAttribute() { return this; } addIndex() { return this; } },
  Shader: {from: (v, f, u) => ({uniforms: {...u}})},
  Mesh: class extends Display { constructor(g, s) { super(); this.geometry = g; this.shader = s; } },
  RenderTexture: {create: ({width, height}) => new RT(width, height)},
  Texture: class {
    /** Like PIXI.Texture.fromBuffer: the data stays live; resource.update() re-uploads it. */
    static fromBuffer(data, width, height, options) {
      const t = new this();
      Object.assign(t, {data, width, height, options, uploads: 0, destroyedFlag: false});
      t.baseTexture = {resource: {data, update: () => { t.uploads++; }}};
      t.destroy = () => { t.destroyedFlag = true; };
      return t;
    }
  },
  SCALE_MODES: {NEAREST: 0, LINEAR: 1}, MIPMAP_MODES: {OFF: 0, ON: 1}, WRAP_MODES: {CLAMP: 33071, REPEAT: 10497}, ALPHA_MODES: {NPM: 0, UNPACK: 1, PMA: 2},
  Application: class { constructor() { this.renderer = renderer; this.ticker = {add: () => {}, remove: () => {}, deltaMS: 16}; this.stage = new Display(); this.view = {parentElement: null}; } destroy() {} },
  BLEND_MODES: {NORMAL: 0, ADD: 1, SCREEN: 3},
  UPDATE_PRIORITY: {HIGH: 25, OBJECTS: 23, LOW: -25}
};
Math.toRadians = d => d * Math.PI / 180;
Math.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- Foundry ---------------- */
const generators = [];
class ParticleGenerator {
  constructor(cfg) { this.cfg = cfg; this.particles = []; this.adjustedMaxParticles = cfg.count; this.spawned = 0; this.stopped = null; generators.push(this); }
  start() { this.started = true; this.particlesContainer ??= new PrimaryCanvasParticleContainer(); this.particlesContainer.elevation = this.cfg.elevation ?? 0; }
  stop({hard = false} = {}) { this.stopped = hard ? "hard" : "soft"; }
  spawnParticles(n) { this.spawned += n; for ( let i = 0; i < n; i++ ) this.particles.push({}); }
  spawnParticle({position}) { (this.at ??= []).push(position); }
}
class PrimaryCanvasParticleContainer extends Display { elevation = 0; sortLayer = 0; sort = 0; }
const uploads = [];
globalThis.foundry = {
  utils: {
    randomID: (n = 16) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "x"),
    // Like Foundry: plain objects and arrays are copied, anything else (a DataModel like LightData) is returned as-is
    deepClone: function dc(o) {
      if ( (typeof o !== "object") || (o === null) ) return o;
      if ( Array.isArray(o) ) return o.map(dc);
      const proto = Object.getPrototypeOf(o);
      if ( (proto !== Object.prototype) && (proto !== null) ) return o;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, dc(v)]));
    },
    setProperty: setProp, getProperty: getProp,
    hasProperty: (o, p) => getProp(o, p) !== undefined,
    debounce: f => f,
    escapeHTML: s => s,
    isEmpty: o => !o || Object.keys(o).length === 0,
    isSubclass: () => true
  },
  data: {operators: {ForcedDeletion}},
  abstract: {Document: class {}},
  canvas: {
    placeables: {get Token() { return TokenObj; }},
    primary: {PrimaryCanvasParticleContainer},
    animation: {ParticleGenerator},
    layers: {
      PlaceablesLayer: class extends Display { storeHistory() {} },
      InteractionLayer: class extends Display { static get layerOptions() { return {}; } get active() { return !!this._active; } activate() { this._active = true; return this; } deactivate() { this._active = false; return this; } async _draw() {} async _tearDown() {} }
    }
  },
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.rendered = false; this.minimized = false; this.options = {window: {minimizable: true}, ...options};
          this.id = options.id ?? new.target.DEFAULT_OPTIONS?.id;
          this.position = {left: 50, top: 40, width: 900, height: 640, ...(options.position ?? {})};
        }
        render() { this.rendered = true; return this; }
        async minimize() { this.minimized = true; } async maximize() { this.minimized = false; }
        setPosition(p = {}) { Object.assign(this.position, p); return this.position; }
        async close() { this.rendered = false; return this; }
        _onClose() {} async _onRender() {} async _onFirstRender() {} bringToFront() {}
      },
      HandlebarsApplicationMixin: B => class extends B {},
      DialogV2: {confirm: async () => true}
    },
    handlebars: {loadTemplates: () => {}},
    apps: {FilePicker: {implementation: {
      async createDirectory() {},
      async browse() { return {files: []}; },
      async upload(src, dir, file) { uploads.push(`${dir}/${file.name}`); return {status: "success", path: `${dir}/${file.name}`}; }
    }}},
    sidebar: {apps: {ModuleManagement: class {}}}
  }
};
globalThis.CONST = {DOCUMENT_OWNERSHIP_LEVELS: {INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3}, TOKEN_DISPLAY_MODES: {NONE: 0}, TOKEN_DISPOSITIONS: {HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1}, GRID_SNAPPING_MODES: {CENTER: 1}};
globalThis.CONFIG = {Canvas: {layers: {}}, queries: {}};
globalThis.Blob = class { constructor(parts, opts) { this.type = opts?.type; } };
globalThis.File = class { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } };
globalThis.document = {createElement: () => ({replaceChildren() {}})};
globalThis._del = new ForcedDeletion();

/* ---------------- Documents ---------------- */
class Collection extends Map {
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  map(fn) { return [...this.values()].map(fn); }
  some(fn) { return [...this.values()].some(fn); }
  get contents() { return [...this.values()]; }
  [Symbol.iterator]() { return this.values(); }
}
let idn = 0;
/** A stand-in for Foundry's LightData: a model object that updates change in place. */
class LightData {}
const modelLight = d => { if ( d.light && (typeof d.light === "object") ) Object.setPrototypeOf(d.light, LightData.prototype); };
const OWNERSHIP = {INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3};
/** Like Foundry: an unlinked token with an actor has an ActorDelta (here with an update() of its own). */
const attachDelta = doc => {
  if ( !doc.actorId || doc.actorLink ) return;
  doc.delta ??= {};
  if ( !Object.getOwnPropertyDescriptor(doc.delta, "update") ) {
    Object.defineProperty(doc.delta, "update", {enumerable: false, value: async changes => {
      const ex = expand(changes);
      if ( ex.ownership ) doc.delta.ownership = {...(doc.delta.ownership ?? {}), ...ex.ownership};
      Hooks.callAll("updateToken", doc, {delta: ex}, {});
    }});
  }
};
class TokenDoc {
  constructor(scene, data) {
    this.documentName = "Token"; this.parent = scene; this.id = data._id ?? `tok${++idn}`;
    Object.assign(this, {name: "Token", x: 0, y: 0, width: 1, height: 1, elevation: 0, alpha: 1, hidden: false, disposition: 0, flags: {}}, clone(data));
    modelLight(this);
    attachDelta(this);
    this.object = new TokenObj(this);
  }
  /** Foundry's rule: no actor, everyone owns it; otherwise the (synthetic) actor's ownership decides. */
  testUserPermission(user, level = "OWNER") {
    if ( user?.isGM ) return true;
    if ( !this.actorId ) return true;
    if ( !game.actors.get(this.actorId) ) return false;
    const own = this.delta?.ownership ?? game.actors.get(this.actorId).ownership ?? {};
    return (own[user.id] ?? own.default ?? 0) >= OWNERSHIP[level];
  }
  get isOwner() { return this.testUserPermission(game.user, "OWNER"); }
  /** The stored data, as plain objects. */
  get _source() { return this.toObject(); }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  toObject() { const {parent, object, documentName, id, ...rest} = this; return {...clone(rest), _id: id}; }
  canUserModify(user) { return this.testUserPermission(user, "OWNER"); }
  async update(changes, options = {}) { return this.parent.updateEmbeddedDocuments("Token", [{_id: this.id, ...changes}], options); }
}
class TokenObj {
  constructor(doc, {preview = false} = {}) { this.document = doc; this.id = doc.id; this.mesh = {texture: "file-texture", rotation: 0}; this.texture = "file-texture"; this.visible = true; this.destroyed = false; this.flagsSet = 0;
    this.isPreview = preview; this.layer = {active: true}; this.renderFlags = {set: () => { this.flagsSet++; }}; }
  get isOwner() { return true; }
  _canView() { return "original"; }
  control() { this.controlled = true; }
  get center() { return {x: this.document.x + (this.document.width * 50), y: this.document.y + (this.document.height * 50)}; }
  get w() { return this.document.width * 100; }
  get h() { return this.document.height * 100; }
  get bounds() { const d = this.document; return {contains: (x, y) => (x >= d.x) && (x <= d.x + this.w) && (y >= d.y) && (y <= d.y + this.h)}; }
}
const sceneOps = [];
class SceneDoc {
  constructor(id) { this.id = id; this.documentName = "Scene"; this.flags = {}; this.tokens = new Collection(); this.walls = new Collection(); this.dimensions = {size: 100, distance: 5}; }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async update(changes) { const ex = expand(changes); applyOps(this, ex); Hooks.callAll("updateScene", this, ex); return this; }
  async createEmbeddedDocuments(type, data, options = {}) {
    sceneOps.push({op: "create", options, type});
    if ( type === "Wall" ) {
      const made = data.map(d => ({...clone(d), id: d._id ?? `wall${++idn}`, documentName: "Wall", getFlag(sc, k) { return this.flags?.[sc]?.[k]; }}));
      for ( const w of made ) this.walls.set(w.id, w);
      return made;
    }
    const docs = data.map(d => new TokenDoc(this, d));
    for ( const d of docs ) { this.tokens.set(d.id, d); Hooks.callAll("createToken", d, options); canvas.tokens.placeables.push(d.object); Hooks.callAll("drawToken", d.object); }
    return docs;
  }
  async updateEmbeddedDocuments(type, updates, options = {}) {
    sceneOps.push({op: "update", options});
    for ( const u of updates ) {
      const d = this.tokens.get(u._id);
      if ( !d ) continue;
      const {_id, ...rest} = u;
      const ex = expand(rest);
      applyOps(d, ex);
      modelLight(d);
      attachDelta(d);
      Hooks.callAll("updateToken", d, ex, options);
    }
  }
  async deleteEmbeddedDocuments(type, ids, options = {}) {
    sceneOps.push({op: "delete", options, ids, type});
    if ( type === "Wall" ) {
      for ( const id of ids ) this.walls.delete(id);
      return;
    }
    // Like Foundry: the documents leave the collection and deleteToken fires, then the canvas objects are destroyed
    const gone = [];
    for ( const id of ids ) {
      const d = this.tokens.get(id);
      if ( !d ) continue;
      this.tokens.delete(id);
      Hooks.callAll("deleteToken", d, options);
      gone.push(d);
    }
    for ( const d of gone ) {
      canvas.tokens.placeables = canvas.tokens.placeables.filter(t => t.document !== d);
      d.object.destroyed = true;
      Hooks.callAll("destroyToken", d.object);
    }
  }
}
const scene = new SceneDoc("S1");
const settings = new Map([[`${MOD}.library`, {}], [`${MOD}.playersCanCast`, true], [`${MOD}.animate`, true], [`${MOD}.fps`, 30],
  [`${MOD}.quality`, 1], [`${MOD}.emitters`, true], [`${MOD}.particleActor`, ""], ["kostis-flying-paths.assetFolder", ""]]);
const me = {id: "u1", isGM: true, isSelf: true, active: true, can: () => true, targets: new Set()};
const worldPlayer = {id: "u2", name: "Player", isGM: false, isSelf: false, active: true, can: () => false, targets: new Set(), viewedScene: "S1"};
const worldUsers = [me, worldPlayer];
const modules = {
  "kostis-flying-paths": {id: "kostis-flying-paths", active: true, version: "1.0.0"},
  [MOD]: {id: MOD, active: true, version: "1.0.0"},
  [KAA]: {id: KAA, active: true, version: "1.2.0"}
};
let NOW = 1_000_000;
const socketOut = [];
globalThis.game = {
  ready: true, user: me,
  users: {activeGM: me, get: id => worldUsers.find(u => u.id === id) ?? null, filter: f => worldUsers.filter(f), find: f => worldUsers.find(f),
    get contents() { return [...worldUsers]; }},
  actors: new Collection(), folders: new Collection(),
  documentTypes: {Actor: ["base", "character", "npc", "vehicle"]}, system: {id: "dnd5e"},
  world: {id: "w"}, scenes: Object.assign([scene], {get: id => (id === scene.id ? scene : null)}),
  settings: {register: () => {}, get: (m, k) => settings.get(`${m}.${k}`), set: async (m, k, v) => { settings.set(`${m}.${k}`, v); }},
  keybindings: {register: () => {}},
  modules: {get: id => modules[id] ?? null},
  socket: {on: () => {}, emit: (n, m) => socketOut.push(m)},
  i18n: {localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}`},
  time: {get serverTime() { return NOW; }},
  activeTool: ""
};
const actorsMade = [];
globalThis.Actor = {implementation: {create: async data => {
  const a = {...clone(data), id: `actor${++idn}`, documentName: "Actor"};
  game.actors.set(a.id, a);
  actorsMade.push(a);
  return a;
}}};
globalThis.Folder = {implementation: {create: async data => { const f = {...data, id: `folder${++idn}`}; game.folders.set(f.id, f); return f; }}};
const warnings = [];
globalThis.ui = {notifications: {warn: m => warnings.push(m), info: () => {}, error: m => warnings.push(m)}, controls: {render: () => {}, activate: () => {}}};
globalThis.canvas = {
  ready: true, scene, dimensions: {size: 100, distance: 5},
  app: {renderer, ticker: {add: (fn, ctx) => tickerFns.push({fn, ctx}), remove: fn => { const i = tickerFns.findIndex(t => t.fn === fn); if ( i >= 0 ) tickerFns.splice(i, 1); }}},
  tokens: {placeables: [], controlled: [], get: id => canvas.tokens.placeables.find(t => t.id === id)},
  primary: new Display(),
  grid: {getSnappedPoint: p => ({x: Math.round(p.x / 100) * 100 + 50, y: Math.round(p.y / 100) * 100 + 50})},
  stage: {pivot: {x: 500, y: 500}, scale: {x: 1, y: 1}}
};

/* ---------------- Animator mock (real templates) ---------------- */
const {BUILTIN_TEMPLATES} = await import(pathToFileURL(MODS + "kostis-actual-animator/scripts/templates.js").href);
const applied = [];
const {animationTrack} = await import(pathToFileURL(MODS + "kostis-actual-animator/scripts/track.js").href);
const kaaAnims = new Map();
const draws = [];
modules[KAA].api = {
  getAnimation: id => kaaAnims.get(id) ?? null,
  track: (anim) => animationTrack(typeof anim === "object" ? anim : kaaAnims.get(anim)),
  createAnimation: async data => { const id = data.id ?? `P${kaaAnims.size + 1}`; const a = {...structuredClone(data), id, rev: 1, tokens: data.tokens ?? [], steps: (data.steps ?? []).map((st, i) => ({id: `s${i}`, enabled: true, ...st}))}; kaaAnims.set(id, a); await scene.update({flags: {[KAA]: {animations: {[id]: {rev: 1}}}}}); return a; },
  draw: (id, tool) => draws.push({id, tool}),
  templates: () => BUILTIN_TEMPLATES,
  // Like the real one: each call stores a new animation on the scene
  applyTemplate: async (id, tokens, opts) => {
    applied.push({id, tokens, opts});
    const animId = `T${applied.length}`;
    kaaAnims.set(animId, {id: animId, name: id, rev: 1, tokens: [...tokens], steps: []});
    for ( const tid of tokens ) await scene.tokens.get(tid)?.update({flags: {[KAA]: {playback: {anim: animId, t0: NOW}}}});
    return {id: animId};
  },
  deleteAnimation: async id => { kaaAnims.delete(id); },
  status: doc => (doc?.getFlag(KAA, "playback") ? {playing: true, paused: false, anim: {id: "A1", name: "Orbit"}, progress: 0.5, rate: 1, copies: 0} : {playing: false}),
  togglePause: async () => {},
  stop: async tokens => { for ( const id of tokens ) { const d = scene.tokens.get(id); if ( d?.flags?.[KAA] ) delete d.flags[KAA].playback; } },
  setRate: async () => {},
  animations: () => [{id: "A1", name: "Orbit", tokens: []}, ...[...kaaAnims.values()]],
  openPanel: () => {}
};

/* ---------------- Load hub + module ---------------- */
await import(pathToFileURL(MODS + "kostis-flying-paths/scripts/hub.js").href);
await imp("main.js");
Hooks.callAll("init");
Hooks.callAll("setup");
Hooks.callAll("ready");
const api = globalThis.KPE;
const kfp = globalThis.KFP;
ok(api && kfp, "module and hub APIs are exposed (KPE, KFP)");

/* ---------------- Presets ---------------- */
const {BUILTIN_PRESETS, normalizePreset, LOOK_FIELDS, visualKey} = await imp("presets.js");
const {KINDS, FRAGMENT} = await imp("shader.js");
const {BUILTIN_EMITTERS, normalizeEmitter} = await imp("emitter-presets.js");
const {BUILTIN_EFFECTS, normalizeEffect} = await imp("effect-presets.js");
const ids = BUILTIN_PRESETS.map(p => p.id);
ok(BUILTIN_PRESETS.length >= 40 && new Set(ids).size === ids.length, `${BUILTIN_PRESETS.length} built-in particles with unique ids`);
ok(Object.keys(KINDS).every(k => BUILTIN_PRESETS.some(p => p.kind === k)), "every kind has at least one built-in");
ok(BUILTIN_PRESETS.every(p => Object.entries(LOOK_FIELDS).every(([k, f]) => p.look[k] >= f.min && p.look[k] <= f.max)), "built-in looks are within the slider ranges");
const wild = normalizePreset({kind: "nope", palette: ["red"], look: {size: 9, detail: -3}, token: {size: 0}});
ok(wild.kind === "orb" && wild.look.size === 0.95 && wild.look.detail === 1 && wild.token.size === 0.1 && /^#[0-9a-f]{6}$/.test(wild.palette[0]), "normalizePreset clamps junk to valid values");
ok(visualKey(normalizePreset({name: "A"})) === visualKey(normalizePreset({name: "B"})), "the visual key ignores names");
const uniforms = [...FRAGMENT.matchAll(/uniform \w+ (\w+);/g)].map(m => m[1]);
const {uniformsFor, createParticleMesh: meshFor} = await imp("shader.js");
const supplied = {...uniformsFor(BUILTIN_PRESETS[0], 0), ...meshFor(BUILTIN_PRESETS[0], 32).shader.uniforms};
ok(uniforms.every(u => u in supplied), `every shader uniform is supplied (${uniforms.length})`);
const particleIds = new Set(ids);
ok(BUILTIN_EMITTERS.every(e => e.particle === "inherit" || particleIds.has(e.particle)), "emitters use existing particles");
const emitterIds = new Set(BUILTIN_EMITTERS.map(e => e.id));
const templateIds = new Set(BUILTIN_TEMPLATES.map(t => t.id));
const badFx = BUILTIN_EFFECTS.filter(e => !particleIds.has(e.particle) || (e.animation && !templateIds.has(e.animation))
  || (e.trail && !emitterIds.has(e.trail)) || (e.impact && !emitterIds.has(e.impact)));
ok(!badFx.length, `effects use existing particles, animator templates and emitters${badFx.length ? ": " + badFx.map(e => e.name).join(", ") : ""}`);
ok(BUILTIN_EFFECTS.filter(e => e.trail).every(e => !BUILTIN_EMITTERS.find(x => x.id === e.trail).oneShot)
  && BUILTIN_EFFECTS.filter(e => e.impact).every(e => BUILTIN_EMITTERS.find(x => x.id === e.impact).oneShot), "trails are streams and impacts are bursts");
const ne = normalizeEmitter({lifeMin: 3, lifeMax: 1, speedMin: 5, speedMax: 1});
ok(ne.lifeMax === 3 && ne.speedMax === 5, "emitter ranges are kept in order");
ok(normalizeEffect({count: 99, lifetime: "x"}).count === 12 && normalizeEffect({}).lifetime === "animation", "effects are clamped");

/* ---------------- Library ---------------- */
const {Library} = await imp("library.js");
ok(Library.get("particles", "Fireball")?.id === "builtin-fireball", "items can be found by name");
const saved = await Library.save("particles", {...Library.get("particles", "builtin-fireball"), name: "My fireball"}, {copy: true});
ok(saved.id !== "builtin-fireball" && !saved.builtin && Library.get("particles", saved.id)?.name === "My fireball", "a built-in can be saved as the user's own copy");
const again = await Library.save("particles", {...saved, name: "Renamed"});
ok(again.id === saved.id && Library.mine("particles").length === 1, "saving one's own item updates it in place");
ok(Library.all("particles").length === BUILTIN_PRESETS.length + 1, "the library lists built-ins plus the user's own");
await Library.delete("particles", saved.id);
ok(!Library.get("particles", saved.id), "items can be deleted");
// Built-ins can be changed for the world (everything that uses them follows), and reset
{
  const orig = Library.get("particles", "builtin-arcane-orb");
  const changed = await Library.save("particles", {...orig, palette: ["#000000", "#ff0000", "#00ff00", "#0000ff"], look: {...orig.look, glow: 0.1}});
  const now = Library.get("particles", "builtin-arcane-orb");
  ok(changed.id === "builtin-arcane-orb" && now.builtin && now.edited && now.palette[1] === "#ff0000" && now.look.glow === 0.1 && now.category === orig.category
    && Library.mine("particles").length === 0 && Library.all("particles").length === BUILTIN_PRESETS.length,
  "saving a built-in changes it in place (still a built-in, in its own category)");
  ok(Library.get("particles", "Arcane orb").palette[1] === "#ff0000" && Library.edited("particles", "builtin-arcane-orb") && !Library.edited("particles", "builtin-fireball"),
    "by name too, and only that one is marked as changed");
  ok(Library.original("particles", "builtin-arcane-orb").palette[1] !== "#ff0000", "the original is still known");
  ok(await Library.reset("particles", "builtin-arcane-orb") && !Library.get("particles", "builtin-arcane-orb").edited
    && Library.get("particles", "builtin-arcane-orb").palette[1] === orig.palette[1], "Reset brings the original back");
  ok(!(await Library.reset("particles", "builtin-fireball")), "(an unchanged one has nothing to reset)");
}

/* ---------------- Token data ---------------- */
const {ParticleTokens} = await imp("tokens.js");
const fire = Library.get("particles", "builtin-fireball");
const td = ParticleTokens.tokenData(fire, {scene, center: {x: 500, y: 300}, src: "a.webp", size: 0.5, disposition: 1, spawn: {cast: "c"}, emitters: {trail: {emitter: "e"}}});
ok(td.width === 0.5 && near(td.x, 475, 1e-9) && near(td.y, 275, 1e-9), "particle tokens are centred on the spawn point");
ok(td.texture.src === "a.webp" && td.lockRotation === true && td.disposition === 1, "image, upright orbs and the caster's side");
ok(td.light.dim === 15 && td.light.color === fire.palette[2] && td.light.animation.type === "torch", "orbs light the map in their own colour");
ok(td.flags[MOD].particle.preset.id === fire.id && td.flags[MOD].spawn.cast === "c" && td.flags[MOD].emitters.trail, "the look, lifetime and trail ride along in the token's flags");
ok(!ParticleTokens.tokenData(Library.get("particles", "builtin-spark"), {scene, center: {x: 0, y: 0}, src: "s"}).light, "sparks don't emit light");

/* ---------------- Spawning, live textures ---------------- */
const {LiveTextures} = await imp("textures.js");
Hooks.callAll("canvasReady");
const spawned = await api.spawn("Arcane orb", [{x: 300, y: 300}, {x: 600, y: 300}]);
ok(spawned.length === 2 && scene.tokens.size === 2, "spawn creates particle tokens");
ok(uploads.length === 1 && /particles\/orb-arcane-orb-[0-9a-f]{8}\.webp$/.test(uploads[0]), `the look is baked to one file (${uploads[0]})`);
ok(sceneOps.filter(o => o.op === "create").every(o => o.options.kfpNoHistory), "spawning stays out of Ctrl+Z");
const [o1, o2] = spawned.map(id => scene.tokens.get(id));
ok(o1.object.mesh.texture instanceof RT && o1.object.mesh.texture !== "file-texture", "particle tokens show a live animated texture");
ok(o1.flags[MOD].particle.variant !== o2.flags[MOD].particle.variant && LiveTextures.size === 2, "neighbours get different variants so they don't pulse in sync");
await api.spawn("Arcane orb", {x: 900, y: 300});
ok(uploads.length === 1, "the image is baked once and reused");
const before = renders;
const tick = tickerFns.find(t => t.ctx === LiveTextures);
await new Promise(r => setTimeout(r, 40));
tick.fn.call(tick.ctx);
ok(renders > before, "live textures re-render on the ticker");
settings.set(`${MOD}.animate`, false);
ParticleTokens.applyAll();
ok(o1.object.mesh.texture === "file-texture", "turning animation off shows the baked image");
settings.set(`${MOD}.animate`, true);
ParticleTokens.applyAll();
ok(o1.object.mesh.texture instanceof RT, "and back on");

/* ---------------- Auras ---------------- */
const hero = (await scene.createEmbeddedDocuments("Token", [{name: "Hero", x: 1000, y: 1000, width: 1, height: 1, disposition: 1}]))[0];
const auraId = await api.attachAura([hero.object], "Fire aura", {scale: 1.2});
const auraFlag = hero.getFlag(MOD, "auras")?.[auraId];
ok(auraFlag?.preset?.id === "builtin-fire-aura" && auraFlag.scale === 1.2, "auras are stored on the token");
const auraC = canvas.primary.children.find(c => c instanceof PrimaryCanvasParticleContainer);
ok(auraC && auraC.sortLayer === 699 && near(auraC.position.x, 1050, 1e-9), "the aura is drawn under the token, centred on it");
const auraSprite = auraC.children[0];
ok(near(auraSprite.width, (100 * 1.2) / 0.5, 1e-9), `its inner ring fits the token footprint (${auraSprite.width}px)`);
hero.x = 1200;
const auraTick = tickerFns.find(t => t.fn.name.includes("tick") && t.ctx?.name === "Auras") ?? tickerFns.find(t => t.ctx?.name === "Auras");
auraTick.fn.call(auraTick.ctx);
ok(near(auraC.position.x, 1250, 1e-9), "auras follow the token's displayed position (animator motion included)");
await api.removeAuras([hero.object]);
ok(!hero.getFlag(MOD, "auras") && auraC.destroyed, "removing auras clears the flag and the sprite");

/* ---------------- Emitters ---------------- */
const {generatorConfig, emitterParticle} = await imp("emitters.js");
const trail = Library.get("emitters", "builtin-spark-trail");
ok(emitterParticle(trail, fire).id === fire.id && emitterParticle(trail).id === "builtin-spark", "'inherit' emitters take the colours of their token");
const gen0 = generators.length;
await api.addEmitter([hero.object], "Rising embers");
const g = generators.at(-1);
ok(generators.length === gen0 + 1 && g.started, "attaching an emitter starts a particle generator");
ok(g.particlesContainer.sortLayer === 701, "its particles draw above tiles and tokens at the same elevation");
hero.elevation = 30;
g.cfg.onTick(0, g);
ok(g.particlesContainer.elevation === 30, "and follow the token's elevation");
hero.elevation = 0;
ok(typeof g.cfg.anchor === "function" && near(g.cfg.anchor().x, 1250, 1e-9), "it is anchored to the token's live centre");
ok(g.cfg.area.radius === 45 && g.cfg.blend === 1 && g.cfg.lifetime[0] === 1200, "area, blend and lifetime come from the preset");
ok(Array.isArray(g.cfg.textures) && g.cfg.textures.length === 3, "with three procedural texture variants");
// Gravity bends the path
const p = {};
const out = {x: 0, y: 0};
g.cfg.velocity.fn(p, 0, out);
const vy0 = out.y;
g.cfg.velocity.fn(p, 1000, out);
ok(near(out.y - vy0, -15, 1e-6), `gravity accelerates particles (Δvy ${(out.y - vy0).toFixed(2)} px/s over 1 s)`);
// Spawning budget pauses while the token is hidden
g.cfg.onTick(1000, g);
const n1 = g.spawned;
hero.object.visible = false;
g.cfg.onTick(1000, g);
ok(n1 === 10 && g.spawned === n1, "emitters spawn at their rate and pause while the token is hidden");
hero.object.visible = true;
await api.removeEmitters([hero.object]);
ok(g.stopped === "soft", "removing an emitter lets its last particles fade");
const sceneEm = await api.placeEmitter({x: 50, y: 60}, "Fireflies");
const gs = generators.at(-1);
ok(scene.getFlag(MOD, "emitters")?.[sceneEm] && gs.cfg.anchor.x === 50 && gs.cfg.behavior === "orbit", "fixed emitters live in the scene and can orbit their point");
await api.removeSceneEmitter(sceneEm);
ok(gs.stopped === "soft" && !scene.getFlag(MOD, "emitters")?.[sceneEm], "and can be removed");
const torch = (await scene.createEmbeddedDocuments("Token", [{name: "Torch bearer", x: 500, y: 500}]))[0];
await api.addEmitter([torch.object], "Rising embers");
const torchGen = generators.at(-1);
await scene.deleteEmbeddedDocuments("Token", [torch.id]);
ok(torchGen.stopped === "soft", "deleting a token stops its emitter (deleteToken fires before the token leaves the canvas)");
const tokenArea = generatorConfig(normalizeEmitter({area: "token"}), {anchor: {x: 0, y: 0}, grid: 100, textures: [{width: 64}], footprint: 200});
ok(tokenArea.area.width === 200 && tokenArea.area.x === -100, "'over the token' spawns across its footprint");
socketOut.length = 0;
const genB = generators.length;
api.burst("Impact burst", {x: 10, y: 20}, {source: fire});
ok(socketOut[0]?.type === "burst" && generators.length === genB + 1 && generators.at(-1).spawned === 40, "bursts play here and are broadcast to everyone");
ok(generators.at(-1).particlesContainer.sortLayer === 702, "bursts show over the token they hit");

/* ---------------- Casting ---------------- */
const goblin = (await scene.createEmbeddedDocuments("Token", [{name: "Goblin", x: 2000, y: 1000, disposition: -1}]))[0];
// Pick the caster on the token layer, then switch to the Flying Paths controls: Foundry deactivates the token layer
// and releases the selection, but the cast still knows who is casting
canvas.tokens.active = true;
canvas.tokens.controlled = [hero.object];
Hooks.callAll("controlToken", hero.object, true);
await flush();
canvas.tokens.active = false;
canvas.tokens.controlled = [];
Hooks.callAll("controlToken", hero.object, false);
await flush();
me.targets = new Set();
warnings.length = 0;
const refusedCast = await api.cast("Magic missile");
ok(refusedCast === null && warnings.includes("KPE.Warn.NeedsTarget"), "attacks need a target");
me.targets = new Set([goblin.object]);
const tokensBefore = scene.tokens.size;
const res = await api.cast("Magic missile");
ok(res?.tokens.length === 1 && scene.tokens.size === tokensBefore + 1, "casting spawns the particle");
const missile = scene.tokens.get(res.tokens[0]);
ok(near(missile.x + 20, 1250, 1e-6) && missile.disposition === 1, "at the caster (selected before switching to our controls), on the caster's side");
ok(applied.at(-1).id === "builtin-missiles" && applied.at(-1).opts.targets[0] === goblin.id, "and flies it with the animator template at the targets");
const missileCast = missile.getFlag(MOD, "spawn").cast;
const missileAnim = scene.getFlag(MOD, "casts")?.[missileCast]?.animId;
ok(missileAnim && kaaAnims.has(missileAnim), "the cast's animation is recorded on the scene (so any GM can clean it up, even after a reload)");
ok(missile.getFlag(MOD, "emitters")?.trail?.emitter === "builtin-spark-trail" && missile.getFlag(MOD, "spawn").impact === "builtin-impact", "with its trail and impact");
// The animation ends → impact + despawn (GM janitor)
socketOut.length = 0;
await missile.update({flags: {[KAA]: {playback: new ForcedDeletion()}}});
await flush();
ok(socketOut.some(m => m.type === "burst" && m.emitter.id === "builtin-impact"), "when its animation ends it bursts on impact");
ok(!scene.tokens.has(missile.id), "and disappears");
// Symmetry copies deleted by the animator still burst
const copy = (await scene.createEmbeddedDocuments("Token", [{name: "Copy", x: 0, y: 0, flags: {[MOD]: {spawn: {cast: "x", lifetime: "animation", impact: "builtin-impact"}}}}]))[0];
socketOut.length = 0;
await scene.deleteEmbeddedDocuments("Token", [copy.id], {[KAA]: {despawn: true}});
ok(socketOut.some(m => m.type === "burst"), "symmetry copies removed by the animator burst too");
// Orbit effects circle the caster
const orbitRes = await api.cast("Orbiting orbs");
ok(applied.at(-1).id === "builtin-orbs" && applied.at(-1).opts.targets[0] === hero.id, "orbit effects pass the caster as the token to circle");
ok(scene.tokens.get(orbitRes.tokens[0]).getFlag(MOD, "spawn").lifetime === "forever", "and last until removed");
const orbitAnim = scene.getFlag(MOD, "casts")?.[scene.tokens.get(orbitRes.tokens[0]).getFlag(MOD, "spawn").cast]?.animId;
// Timed lifetimes
const timed = await api.cast("Wisp guard");
const wisp = scene.tokens.get(timed.tokens[0]);
ok(wisp.getFlag(MOD, "spawn").until === NOW + 60000, "timed effects record when they end");
NOW += 61000;
await new Promise(r => setTimeout(r, 1150));
ok(!scene.tokens.has(wisp.id), "and the janitor removes them on time");
ok(!kaaAnims.has(missileAnim) && !(missileCast in (scene.getFlag(MOD, "casts") ?? {})),
  "finished casts' animations are deleted from the scene, with their records");
ok(kaaAnims.has(orbitAnim), "casts still running keep theirs");
// Point effects
const portal = await api.cast("Open a portal", {point: {x: 3000, y: 3000}});
const pt = scene.tokens.get(portal.tokens[0]);
ok(pt && near(pt.x + 100, 3000, 1e-6) && pt.width === 2, "point effects appear where you click");
// Animator missing
modules[KAA].active = false;
warnings.length = 0;
ok((await api.cast("Fireball")) === null && warnings.includes("KPE.Warn.NeedsAnimator"), "effects with motion explain that they need the animator");
modules[KAA].active = true;

/* ---------------- Clear ---------------- */
await api.attachAura([hero.object], "Holy aura");
await api.addEmitter([hero.object], "Magic dust");
await api.clearScene();
ok(!scene.tokens.some(t => t.getFlag(MOD, "particle")) && !hero.getFlag(MOD, "auras") && !hero.getFlag(MOD, "emitters"), "clearing removes every particle, aura and emitter");

/* ---------------- Relay (player side) ---------------- */
{
  // Even a player allowed to create tokens and upload: casts write to the scene, so they go through the GM
  const player = {id: "u2", isGM: false, isSelf: true, active: true, can: () => true, targets: new Set([goblin.object]), viewedScene: "S1"};
  let relayed = 0;
  const gm = {id: "g1", isGM: true, isSelf: false, active: true,
    query: async (name, data) => { relayed++; const asker = game.user; game.user = {...me, id: "g1"}; try { return await CONFIG.queries[name](data, {user: asker}); } finally { game.user = asker; } }};
  game.users.activeGM = gm;
  game.user = player;
  const r = await api.cast("Spirit hammer", {caster: hero.id});
  game.user = me;
  game.users.activeGM = me;
  ok(r?.tokens?.length === 1 && scene.tokens.has(r.tokens[0]) && relayed === 1, "players cast through the GM (relay)");
  settings.set(`${MOD}.playersCanCast`, false);
  game.users.activeGM = gm;
  game.user = player;
  let err = null;
  try { await api.cast("Spirit hammer", {caster: hero.id}); } catch(e) { err = e.message; }
  game.user = me;
  game.users.activeGM = me;
  settings.set(`${MOD}.playersCanCast`, true);
  ok(/may not cast/.test(err ?? ""), "and the GM refuses when players aren't allowed to");

  // What the GM accepts from players
  const asPlayer = async (fn, {can = () => false} = {}) => {
    player.can = can;
    game.users.activeGM = gm;
    game.user = player;
    try { return await fn(); } finally { game.user = me; game.users.activeGM = me; player.can = () => true; }
  };
  const relayCall = (name, payload) => CONFIG.queries["kostis-flying-paths.relay"]({name: `${MOD}.${name}`, payload}, {user: player});
  player.viewedScene = "elsewhere";
  err = null;
  try { await relayCall("spawn", {preset: Library.get("particles", "builtin-spark"), centers: [{x: 1, y: 1}], sceneId: scene.id}); } catch(e) { err = e.message; }
  ok(/scene you are viewing/.test(err ?? ""), "players can only act on the scene they are viewing");
  player.viewedScene = "S1";
  const many = Array.from({length: 500}, (_, i) => ({x: i, y: i}));
  const flood = await relayCall("spawn", {preset: Library.get("particles", "builtin-spark"), centers: many, sceneId: scene.id, size: 900,
    spawn: {lifetime: "timed", until: 0}});
  const fd = scene.tokens.get(flood[0]);
  ok(flood.length === 48 && fd.width === 100 && !fd.getFlag(MOD, "spawn") && fd.getFlag(MOD, "particle").by === "u2", "spawn requests are capped and cleaned (and remember who made them)");
  ok(fd.actorId && fd.testUserPermission(worldPlayer, "OWNER"), "a player's particles are theirs to control");
  await scene.deleteEmbeddedDocuments("Token", flood);
  // Players remove only their own particles
  const gmOrb = (await api.spawn("Arcane orb", {x: 700, y: 700}))[0];
  const myOrbs = await asPlayer(() => api.spawn("Arcane orb", [{x: 800, y: 700}, {x: 900, y: 700}]));
  ok(myOrbs.length === 2 && scene.tokens.get(myOrbs[0]).getFlag(MOD, "particle").by === "u2", "a player places particles through the GM");
  const removed = await relayCall("despawn", {ids: [gmOrb, ...myOrbs], sceneId: scene.id});
  ok(removed === 2 && scene.tokens.has(gmOrb) && !scene.tokens.has(myOrbs[0]), "and can only remove the ones they made");
  // ...and undo that through the GM too
  await asPlayer(() => kfp.history.undo());
  ok(myOrbs.every(i => !scene.tokens.has(i)), "(undoing their placement removes them)");
  const again = await asPlayer(() => api.spawn("Arcane orb", {x: 800, y: 800}));
  await asPlayer(() => api.despawn([again[0]]));
  ok(!scene.tokens.has(again[0]), "a player removes their particle");
  await asPlayer(() => kfp.history.undo());
  ok(scene.tokens.has(again[0]) && scene.tokens.get(again[0]).getFlag(MOD, "particle").by === "u2", "and Ctrl+Z brings it back through the GM");
  // Restores are checked: no actor links, no vision, no foreign images, only their own particles
  const forged = [{_id: "forged1", name: "x", actorId: "hero", actorLink: true, sight: {enabled: true}, texture: {src: "icons/svg/mystery-man.svg"},
    flags: {[MOD]: {particle: {by: "u2"}}}},
  {_id: "forged2", name: "y", texture: {src: "worlds/w/kostis-flying-paths/particles/a.webp"}, sight: {enabled: true}, actorId: "hero",
    flags: {[MOD]: {particle: {by: "u2"}}}},
  {_id: "forged3", name: "z", texture: {src: "worlds/w/kostis-flying-paths/particles/a.webp"}, flags: {[MOD]: {particle: {by: "u1"}}}}];
  const back = await relayCall("restore", {sceneId: scene.id, data: forged});
  const f2 = scene.tokens.get("forged2");
  ok(back === 1 && !scene.tokens.has("forged1") && !scene.tokens.has("forged3") && f2 && (f2.actorId === game.settings.get(MOD, "particleActor"))
    && (Object.keys(f2.delta).join() === "ownership") && f2.testUserPermission(worldPlayer, "OWNER") && f2.sight.enabled === false,
    "restores accept only the player's own particles (on the shared actor, theirs alone, without vision)");
  await scene.deleteEmbeddedDocuments("Token", ["forged2", gmOrb, again[0]]);
}

/* ---------------- Hub registration ---------------- */
{
  const {Registry} = await import(pathToFileURL(MODS + "kostis-flying-paths/scripts/registry.js").href);
  ok(Registry.submodules.has(MOD) && ["kpeStudio", "kpePlace", "kpeEmitter", "kpeCast", "kpeClear"].every(t => Registry.tools.has(t)), "the module registers with the hub and adds its map tools");
  const {KfpLayer} = await import(pathToFileURL(MODS + "kostis-flying-paths/scripts/layer.js").href);
  const ctl = KfpLayer.prepareSceneControls();
  ok(ctl.tools.kpePlace && ctl.tools.kpeStudio.button, "they appear in the shared scene controls");
  const before2 = scene.tokens.size;
  const {State} = await imp("state.js");
  State.select("particles", "builtin-frost-orb");
  await Registry.tools.get("kpePlace").canvas.click({shiftKey: true}, {x: 420, y: 430});
  const placed = scene.tokens.contents.at(-1);
  ok(scene.tokens.size === before2 + 1 && placed.getFlag(MOD, "particle").preset.id === "builtin-frost-orb" && near(placed.x + 30, 450, 1e-6), "the place tool spawns the selected particle (Shift snaps to the grid)");
}

/* ---------------- Studio ---------------- */
{
  const hb = {eq: (a, b) => a === b, not: v => !v};
  for ( const [k, f] of Object.entries(hb) ) Handlebars.registerHelper(k, f);
  for ( const part of ["wall-editor", "outline-tools"] ) {
    Handlebars.registerPartial(`modules/kostis-particle-effects/templates/${part}.hbs`, readFileSync(ROOT + `templates/${part}.hbs`, "utf8"));
  }
  const tpl = Handlebars.compile(readFileSync(ROOT + "templates/studio.hbs", "utf8"));
  const {ParticleStudio} = await imp("studio.js");
  const studio = new ParticleStudio();
  studio.render = function() { this.rendered = true; return this; };
  let html = "";
  const renderTab = async tab => {
    if ( tab ) ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(studio, {}, {dataset: {tab}});
    const ctx = await studio._prepareContext({});
    html = tpl(ctx);
    return ctx;
  };
  let ctx = await renderTab("particles");
  ok(ctx.cards.length > 5 && ctx.cards.every(c => c.thumb.startsWith("data:image")) && html.includes("kpe-card"), `particles tab renders ${ctx.cards.length} cards with thumbnails`);
  ok(html.includes('name="look.warp"') && html.includes('name="palette.0"') && html.includes('data-action="spawnOnMap"'), "the particle editor has sliders, colours and map actions");
  ctx = await renderTab("emitters");
  ok(ctx.editor.emitters && html.includes('name="gravity"') && html.includes('data-action="attachEmitter"'), "emitters tab renders its editor");
  ctx = await renderTab("effects");
  ok(ctx.editor.effects && ctx.editor.templateOptions.some(o => o.value === "builtin-missiles") && html.includes('data-action="castEffect"'), "effects tab lists the animator's templates");
  const used = [...readFileSync(ROOT + "templates/studio.hbs", "utf8").matchAll(/data-action="([^"{]+)"/g)].map(m => m[1]);
  const missing = used.filter(a => !(a in ParticleStudio.DEFAULT_OPTIONS.actions));
  ok(!missing.length, `every studio button is wired${missing.length ? ": missing " + missing.join(", ") : ""}`);
  ok(!["close", "tab", "toggleControls"].some(a => a in ParticleStudio.DEFAULT_OPTIONS.actions), "no reserved ApplicationV2 action names");
  // Editing: a slider changes the draft, saving makes it the user's own
  ctx = await renderTab("particles");
  const listeners = {};
  studio.element = {addEventListener: (t, fn, capture) => { if ( !capture ) listeners[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await studio._onFirstRender({}, {});
  const field = (name, value, type = "range") => ({target: {name, value, type, step: "0.05", dataset: {}, closest: () => null}});
  listeners.input(field("look.warp", "2.5"));
  listeners.input(field("palette.1", "#00ff00", "color"));
  ctx = await renderTab();
  ok(ctx.dirty && ctx.item.look.warp === 2.5 && ctx.item.palette[1] === "#00ff00", "sliders and colours edit the draft live");
  listeners.change(field("kind", "shard", "select-one"));
  ctx = await renderTab();
  ok(ctx.item.kind === "shard" && ctx.item.look.shape === 6, "changing the kind starts from that kind's look");
  const mineBefore = Library.mine("particles").length;
  const builtinId = ctx.item.id;
  await ParticleStudio.DEFAULT_OPTIONS.actions.saveItem.call(studio);
  ctx = await renderTab();
  ok(Library.mine("particles").length === mineBefore && ctx.item.id === builtinId && ctx.item.builtin && ctx.item.kind === "shard" && ctx.edited
    && Library.get("particles", builtinId).edited && html.includes('data-action="resetItem"') && ctx.cards.find(c => c.id === builtinId)?.edited,
  "Save changes a built-in itself, for this world (marked as changed, with Reset)");
  await ParticleStudio.DEFAULT_OPTIONS.actions.saveCopy.call(studio);
  ctx = await renderTab();
  ok(Library.mine("particles").length === mineBefore + 1 && !ctx.item.builtin && ctx.categories.find(c => c.key === "mine").active,
    "Save as mine makes a copy of one's own and shows My particles");
  await ParticleStudio.DEFAULT_OPTIONS.actions.saveCopy.call(studio);
  ok(Library.mine("particles").length === mineBefore + 2, "Save copy duplicates it");
  await ParticleStudio.DEFAULT_OPTIONS.actions.deleteItem.call(studio);
  ok(Library.mine("particles").length === mineBefore + 1, "Delete removes the user's own item");
  await ParticleStudio.DEFAULT_OPTIONS.actions.selectItem.call(studio, {}, {closest: () => ({dataset: {id: builtinId}})});
  await ParticleStudio.DEFAULT_OPTIONS.actions.resetItem.call(studio);
  ctx = await renderTab();
  ok(!Library.edited("particles", builtinId) && ctx.item.id === builtinId && ctx.item.kind !== "shard" && !ctx.edited, "Reset brings back the original built-in");
  ParticleStudio.DEFAULT_OPTIONS.actions.usePalette.call(studio, {}, {dataset: {palette: "frost"}});
  ctx = await renderTab();
  ok(ctx.item.palette[2] === "#7fd8ff", "palette chips recolour the particle");
}

/* ---------------- Drag previews, double-click, undo, manager ---------------- */
{
  const {LiveTextures} = await imp("textures.js");
  const {ParticleTokens} = await imp("tokens.js");
  const {normalizePreset} = await imp("presets.js");
  const history = kfp.history;
  await api.clearScene();
  const [orbId] = await api.spawn("Arcane orb", {x: 700, y: 700});
  const orb = scene.tokens.get(orbId);
  const key = LiveTextures.keyOf(normalizePreset(orb.flags[MOD].particle.preset), orb.flags[MOD].particle.variant);
  const users0 = LiveTextures.users(key);
  // Foundry draws a preview copy (same id) while a token is clicked or dragged
  const copy = new TokenObj(orb, {preview: true});
  Hooks.callAll("drawToken", copy);
  ok(LiveTextures.users(key) === users0 + 1 && copy.mesh.texture instanceof RT, "a drag preview gets its own live texture");
  Hooks.callAll("destroyToken", copy);
  ok(LiveTextures.users(key) === users0 && orb.object.mesh.texture instanceof RT && orb.object.mesh.texture.valid, "and cleaning it up leaves the real orb's texture alone (the vanishing bug)");
  await api.attachAura([orb.object], "Holy aura");
  const auraBox = canvas.primary.children.filter(c => c instanceof PrimaryCanvasParticleContainer && !c.destroyed).length;
  const copy2 = new TokenObj(orb, {preview: true});
  Hooks.callAll("drawToken", copy2);
  Hooks.callAll("destroyToken", copy2);
  ok(canvas.primary.children.filter(c => c instanceof PrimaryCanvasParticleContainer && !c.destroyed).length === auraBox, "auras survive drag previews too");
  // Double-click opens the manager instead of the "no actor" warning
  const {ParticleManager} = await imp("manager.js");
  const proto = foundry.canvas.placeables.Token.prototype;
  ok(proto._canView.call(orb.object, me, {}) === false && ParticleManager.instance, "double-clicking a particle opens the manager");
  const plain = (await scene.createEmbeddedDocuments("Token", [{name: "Plain", x: 0, y: 0}]))[0];
  ok(proto._canView.call(plain.object, me, {}) === "original", "other tokens behave as usual");

  // Undo
  const count0 = scene.tokens.filter(t => t.getFlag(MOD, "particle")).length;
  const placed = await api.spawn("Frost orb", [{x: 100, y: 100}, {x: 200, y: 100}]);
  ok(history.peek()?.label.includes("Place"), `placing is undoable (${history.peek()?.label})`);
  await history.undo();
  ok(!placed.some(id => scene.tokens.has(id)), "undo removes the placed particles");
  await api.attachAura([plain.object], "Fire aura");
  await history.undo();
  ok(!plain.getFlag(MOD, "auras"), "undo removes an added aura");
  await api.addEmitter([plain.object], "Rising embers");
  await api.removeEmitters([plain.object]);
  await history.undo();
  ok(Object.keys(plain.getFlag(MOD, "emitters") ?? {}).length === 1, "undo brings back removed emitters");
  const fixed = await api.placeEmitter({x: 10, y: 10}, "Fireflies");
  await history.undo();
  ok(!scene.getFlag(MOD, "emitters")?.[fixed], "undo removes a placed emitter");
  await api.placeEmitter({x: 20, y: 20}, "Fireflies");
  const before = scene.tokens.filter(t => t.getFlag(MOD, "particle")).map(t => t.id).sort();
  await api.clearScene();
  ok(!scene.tokens.some(t => t.getFlag(MOD, "particle")) && !plain.getFlag(MOD, "emitters"), "clear removes everything");
  await history.undo();
  const after = scene.tokens.filter(t => t.getFlag(MOD, "particle")).map(t => t.id).sort();
  ok(JSON.stringify(after) === JSON.stringify(before) && plain.getFlag(MOD, "emitters") && Object.keys(scene.getFlag(MOD, "emitters") ?? {}).length === 1,
    "undoing a clear brings back the same particles, their emitters and fixed emitters");
  ok(count0 === after.length, "nothing extra was left behind");

  // Manager
  const hb = {eq: (a, b) => a === b, not: v => !v};
  for ( const [k, f] of Object.entries(hb) ) Handlebars.registerHelper(k, f);
  const tpl = Handlebars.compile(readFileSync(ROOT + "templates/manager.hbs", "utf8"));
  const man = ParticleManager.open({tokens: [orbId]});
  man.render = function() { return this; };
  const listeners = {};
  man.element = {addEventListener: (t, fn, capture) => { if ( !capture ) listeners[t] = fn; }, querySelector: sel => (sel.includes("lightFollows") ? {checked: true} : null), querySelectorAll: () => []};
  await man._onFirstRender({}, {});
  const render = async () => { const c = await man._prepareContext({}); return {c, html: tpl(c)}; };
  let {c, html} = await render();
  ok(c.rows.length >= 2 && c.rows.some(r => r.id === orbId && r.selected) && c.rows.some(r => r.id === plain.id && !r.particle), "the manager lists particles and decorated tokens");
  ok(c.count === 1 && c.look && /data-action="applyLook"/.test(html), "and edits the selected one");
  const used = [...readFileSync(ROOT + "templates/manager.hbs", "utf8").matchAll(/data-action="([^"{]+)"/g)].map(m => m[1]);
  const missing = used.filter(a => !(a in ParticleManager.DEFAULT_OPTIONS.actions));
  ok(!missing.length, `every manager button is wired${missing.length ? ": missing " + missing.join(", ") : ""}`);
  for ( const tab of ["token", "attach", "motion", "life"] ) {
    ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab}});
    ({html} = await render());
    if ( !html.includes("kpe-editor-scroll") ) ok(false, `tab ${tab} renders`);
  }
  ok(true, "all manager tabs render");
  ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab: "look"}});
  // Live look editing: shown on the map for this client only, until applied
  const O = () => scene.tokens.get(orbId);
  const srcBefore = O().texture.src;
  const rtBefore = O().object.mesh.texture;
  const field = (name, value, type = "range") => ({target: {name, value, type, step: "0.05", dataset: {}, closest: () => null}});
  listeners.input(field("palette.2", "#00ff00", "color"));
  ok(O().object.mesh.texture !== rtBefore && O().flags[MOD].particle.preset.palette[2] !== "#00ff00", "editing shows the new look on the map at once, without saving it");
  await ParticleManager.DEFAULT_OPTIONS.actions.applyLook.call(man);
  ok(O().flags[MOD].particle.preset.palette[2] === "#00ff00" && O().texture.src !== srcBefore, "Apply makes it permanent (new image)");
  await history.undo();
  ok(O().flags[MOD].particle.preset.palette[2] !== "#00ff00" && O().texture.src === srcBefore, "and Ctrl+Z puts the old look back");
  // Token settings keep the centre when resizing
  const cx = O().x + (O().width * 50);
  await listeners.change(field("token.size", "2", "number"));
  ok(O().width === 2 && Math.abs((O().x + 100) - cx) < 1e-6, "resizing keeps the particle where it is");
  await history.undo();
  ok(O().width !== 2 && Math.abs((O().x + (O().width * 50)) - cx) < 1e-6, "undo restores the size");
  await listeners.change(field("token.lightRadius", "4", "number"));
  ok(O().light.dim === 20, "light radius is set in scene units");
  await history.undo();
  ok(O().light?.dim !== 20, "and undone");
  // Duplicate, hide, delete
  await ParticleManager.DEFAULT_OPTIONS.actions.duplicate.call(man);
  const dupId = man._prepareContext && (await render()).c.primary.id;
  ok(dupId !== orbId && scene.tokens.has(dupId) && scene.tokens.get(dupId).getFlag(MOD, "particle"), "duplicate makes a copy and selects it");
  await history.undo();
  ok(!scene.tokens.has(dupId), "undo removes the copy");
  man.select([orbId]);
  await ParticleManager.DEFAULT_OPTIONS.actions.toggleHidden.call(man);
  ok(scene.tokens.get(orbId).hidden === true, "hide");
  await history.undo();
  ok(!scene.tokens.get(orbId).hidden, "undo hide");
  await ParticleManager.DEFAULT_OPTIONS.actions.deleteSelected.call(man);
  ok(!scene.tokens.has(orbId), "delete");
  await history.undo();
  ok(scene.tokens.has(orbId) && scene.tokens.get(orbId).getFlag(MOD, "particle"), "undo brings the same particle back");
  // Lifetime
  man.select([orbId]);
  man.element.querySelector = sel => (sel.includes("lifeSeconds") ? {value: "30"} : null);
  await ParticleManager.DEFAULT_OPTIONS.actions.setLifetime.call(man, {}, {dataset: {mode: "timed"}});
  ok(scene.tokens.get(orbId).getFlag(MOD, "spawn")?.until === NOW + 30000, "a lifetime can be set");
  await history.undo();
  ok(!scene.tokens.get(orbId).getFlag(MOD, "spawn"), "and undone");
  // A character wearing an aura is listed too, but never gets a despawn timer
  await api.attachAura([plain.object], "Holy aura");
  man.select([plain.id]);
  ({c} = await render());
  ok(c.tabs.find(t => t.key === "life").disabled, "the lifetime tab is off for tokens that aren't particles");
  await ParticleManager.DEFAULT_OPTIONS.actions.setLifetime.call(man, {}, {dataset: {mode: "timed"}});
  ok(!scene.tokens.get(plain.id).getFlag(MOD, "spawn"), "and setting one does nothing to them");
  await api.removeAuras([plain.object]);
  man.select([orbId]);
  // Motion tab with the animator
  await scene.tokens.get(orbId).update({flags: {[KAA]: {playback: {anim: "A1"}}}});
  ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab: "motion"}});
  ({c, html} = await render());
  ok(c.motion.playing && c.motion.anim === "Orbit" && /data-action="motionStop"/.test(html), "the motion tab shows the running animation");
  await ParticleManager.DEFAULT_OPTIONS.actions.motionStop.call(man);
  ok(!scene.tokens.get(orbId).getFlag(KAA, "playback"), "and can stop it");
  man.close?.();
  man._onClose({});
}

/* ---------------- Ownership ---------------- */
{
  const own = await imp("ownership.js");
  await api.clearScene();
  kfp.history.clear();
  // The GM's particles are the GM's
  const gmIds = await api.spawn("Arcane orb", {x: 300, y: 300});
  const gmOrb = scene.tokens.get(gmIds[0]);
  const shared = game.actors.get(game.settings.get(MOD, "particleActor"));
  ok(shared && shared.type === "npc" && shared.ownership.default === 0 && shared.system?.attributes?.hp?.max === 1 && game.folders.get(shared.folder),
    "particles get a shared, empty actor (an NPC, in its own folder) so each can have owners");
  ok(gmOrb.actorId === shared.id && gmOrb.actorLink === false && !gmOrb.testUserPermission(worldPlayer, "OWNER") && gmOrb.testUserPermission(me, "OWNER"),
    "a particle the GM places is the GM's: players can't move or change it");
  const second = (await api.spawn("Frost orb", {x: 400, y: 300}))[0];
  ok(actorsMade.length === 1 && scene.tokens.get(second).actorId === shared.id, "(one shared actor for every particle)");
  // Casts: whoever controls the caster
  const pc = (await scene.createEmbeddedDocuments("Token", [{name: "PC", x: 900, y: 900}]))[0];
  const boss = (await scene.createEmbeddedDocuments("Token", [{name: "Boss", x: 1500, y: 900, actorId: "bossActor", actorLink: true}]))[0];
  game.actors.set("bossActor", {id: "bossActor", ownership: {default: 0, u2: 3}});
  me.targets = new Set([pc.object]);
  const cast = await api.cast("Orb strike", {caster: boss.id});
  ok(cast?.tokens.every(id => scene.tokens.get(id).testUserPermission(worldPlayer, "OWNER")), "a boss the player controls casts orbs the player controls");
  game.actors.set("bossActor", {id: "bossActor", ownership: {default: 0}});
  const cast2 = await api.cast("Orb strike", {caster: boss.id});
  ok(cast2?.tokens.every(id => !scene.tokens.get(id).testUserPermission(worldPlayer, "OWNER")), "a boss only the GM controls casts the GM's orbs");
  const allFx = {...Library.get("effects", "Orb strike"), id: null, owners: "all"};
  const cast3 = await api.cast(allFx, {caster: boss.id});
  ok(cast3?.tokens.every(id => scene.tokens.get(id).testUserPermission(worldPlayer, "OWNER")), "or an effect can leave them to everyone");
  // The manager: who controls it
  const hb = {eq: (a, b) => a === b, not: v => !v};
  for ( const [k, f] of Object.entries(hb) ) Handlebars.registerHelper(k, f);
  const mtpl = Handlebars.compile(readFileSync(ROOT + "templates/manager.hbs", "utf8"));
  const {ParticleManager} = await imp("manager.js");
  const man = ParticleManager.open({tokens: [gmOrb.id]});
  man.render = function() { return this; };
  const listeners = {};
  man.element = {addEventListener: (t, fn, capture) => { if ( !capture ) listeners[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await man._onFirstRender({}, {});
  ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab: "token"}});
  let ctx = await man._prepareContext({});
  ok(ctx.control?.modes.find(m => m.selected)?.value === "gm" && /name="control.mode"/.test(mtpl(ctx)), "the manager shows who controls a particle");
  const field = (name, value, type = "select-one") => ({target: {name, value, type, checked: value, dataset: {}, closest: () => null}});
  await listeners.change(field("control.mode", "players"));
  ctx = await man._prepareContext({});
  ok(ctx.control.chosen && /name="control.user.u2"/.test(mtpl(ctx)) && !gmOrb.testUserPermission(worldPlayer, "OWNER"), "choosing players lists them (nothing changes until one is ticked)");
  await listeners.change(field("control.user.u2", true, "checkbox"));
  ok(scene.tokens.get(gmOrb.id).testUserPermission(worldPlayer, "OWNER"), "ticking a player gives them the particle");
  await kfp.history.undo();
  ok(!scene.tokens.get(gmOrb.id).testUserPermission(worldPlayer, "OWNER"), "and Ctrl+Z takes it back");
  await listeners.change(field("control.mode", "all"));
  ok(scene.tokens.get(gmOrb.id).testUserPermission(worldPlayer, "OWNER") && own.controlOf(scene.tokens.get(gmOrb.id)).mode === "all", "everyone");
  await listeners.change(field("control.mode", "gm"));
  ok(!scene.tokens.get(gmOrb.id).testUserPermission(worldPlayer, "OWNER"), "back to the GM only");
  // Particles made before ownership (no actor: everyone controls them) are linked when changed, and undo unlinks
  const legacy = (await scene.createEmbeddedDocuments("Token", [{name: "Old orb", x: 700, y: 300, flags: {[MOD]: {particle: {preset: Library.get("particles", "Arcane orb")}}}}]))[0];
  ok(own.controlOf(legacy).mode === "all", "older particles (no actor) count as everyone's");
  man.select([legacy.id]);
  await listeners.change(field("control.mode", "gm"));
  ok(scene.tokens.get(legacy.id).actorId === shared.id && !scene.tokens.get(legacy.id).testUserPermission(worldPlayer, "OWNER"), "changing one links it to the shared actor");
  await kfp.history.undo();
  ok(!scene.tokens.get(legacy.id).actorId, "(undo puts it back as it was)");
  // Players see what they control
  game.user = worldPlayer;
  ctx = await man._prepareContext({});
  game.user = me;
  ok(ctx.rows.every(r => scene.tokens.get(r.id).testUserPermission(worldPlayer, "OWNER")) && !ctx.rows.some(r => r.id === gmOrb.id), "players only see the particles they control");
  man._onClose({});
  // The shared actor deleted by mistake: a new one, same owners
  scene.tokens.get(gmOrb.id).delta.ownership.u2 = 3;
  game.actors.delete(shared.id);
  await own.repairParticleActor();
  const fresh = game.settings.get(MOD, "particleActor");
  ok(fresh !== shared.id && game.actors.get(fresh) && scene.tokens.get(gmOrb.id).actorId === fresh && scene.tokens.get(gmOrb.id).testUserPermission(worldPlayer, "OWNER"),
    "if the shared actor is deleted, a new one takes over and every particle keeps its owners");
  // Bigger and sharper
  const {LiveTextures} = await imp("textures.js");
  const orbLook = Library.get("particles", "Arcane orb");
  ok(LiveTextures.tierOf(orbLook, 50) === orbLook.res && LiveTextures.tierOf(orbLook, 1500) === 2048 && LiveTextures.tierOf(orbLook, 9000) === 2048,
    "big particles get sharper textures (up to 2048 px)");
  const man2 = ParticleManager.open({tokens: [second]});
  man2.render = function() { return this; };
  man2.element = {addEventListener: (t, fn, capture) => { if ( !capture ) listeners[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await man2._onFirstRender({}, {});
  await listeners.change({target: {name: "token.size", value: "40", type: "number", dataset: {}, closest: () => null}});
  ok(scene.tokens.get(second).width === 40, "particles can be up to 100 squares (40 here)");
  man2._onClose({});
  await api.clearScene();
  await scene.deleteEmbeddedDocuments("Token", [pc.id, boss.id, legacy.id].filter(id => scene.tokens.has(id)));
  me.targets = new Set();
}

/* ---------------- Molding ---------------- */
{
  const O = await imp("outline.js");
  // Outlines
  ok(O.normalizeOutline(null) === null && O.normalizeOutline({nodes: [{x: 0, y: 0}, {x: 1, y: 0}]}) === null,
    "fewer than three points is no outline (the plain circle)");
  const junk = O.normalizeOutline({nodes: [{x: 5, y: -9, smooth: 3}, {x: "a", y: 0}, {x: 0.5, y: 0.5}, {x: -0.5, y: 0.5, smooth: -1}, {x: 0, y: -0.5}]});
  ok(junk.nodes.length === 4 && junk.nodes[0].x === 1 && junk.nodes[0].y === -1 && junk.nodes[0].smooth === 1 && junk.nodes[2].smooth === 0,
    "outlines are cleaned: points kept inside the square, junk dropped");
  const shapeNames = Object.keys(O.OUTLINE_SHAPES);
  ok(shapeNames.every(k => O.normalizeOutline(O.outlineShape(k, {seed: 3}))?.nodes.length >= 3), `every starting shape is a valid outline (${shapeNames.length})`);
  const circ = O.radialProfile(O.outlineShape("circle"));
  ok(circ.length === O.PROFILE_SIZE && circ.every(r => Math.abs(r - 0.97) < 0.02), "the starting circle reaches as far all the way round");
  const sqProfile = O.radialProfile(O.outlineShape("square"));
  const reachAt = deg => sqProfile[Math.floor(((((deg * Math.PI) / 180) + Math.PI) / (2 * Math.PI)) * O.PROFILE_SIZE)];
  ok(Math.abs(reachAt(0) - 0.9) < 0.01 && Math.abs(reachAt(45) - (0.9 * Math.SQRT2)) < 0.04 && Math.abs(reachAt(-90) - 0.9) < 0.01,
    "a square reaches its sides straight out and its corners on the diagonals");
  ok(O.radialProfile(null).every(r => r === 1), "no outline is the plain circle");
  const enc = O.encodeProfile(sqProfile);
  ok([...sqProfile].every((r, j) => Math.abs(O.decodeProfile(enc, j) - r) < 1e-4), "the outline survives the trip to the shader (16 bits a direction)");
  // Editing
  const square = O.outlineShape("square");
  const edge = O.nearestOnOutline(square, {x: 0, y: -1.2});
  ok(edge.segment === 0 && Math.abs(edge.x) < 0.05 && Math.abs(edge.y + 0.9) < 0.01, "the nearest point on an edge is found");
  const five = O.insertNode(square, edge.segment, edge.x, edge.y);
  ok(five.nodes.length === 5 && five.nodes[1].smooth === 0, "a point added on a straight edge is a corner (pull it out to make new edges)");
  const pulled = O.moveNode(five, 1, 0, -1.5);
  ok(pulled.nodes[1].y === -1 && square.nodes.length === 4 && five.nodes[1].y !== -1, "points stay inside the particle's square, and edits never change the original");
  ok(O.toggleCorner(square, 0).nodes[0].smooth === 1 && O.toggleCorner(O.toggleCorner(square, 0), 0).nodes[0].smooth === 0, "a corner turns round and back");
  ok(O.removeNode(O.outlineShape("triangle"), 0).nodes.length === 3 && O.removeNode(square, 0).nodes.length === 3, "points can be removed, down to three");
  const slid = O.moveOutline(square, 0.5, 0).nodes.map(n => n.x);
  ok(Math.max(...slid) === 1 && Math.abs(Math.min(...slid) + 0.8) < 1e-9, "the whole outline moves, and stops at the edge");
  const stroke = [];
  for ( let i = 0; i <= 40; i++ ) stroke.push({x: -0.6 + (1.2 * i / 40), y: -0.6});
  for ( let i = 0; i <= 40; i++ ) stroke.push({x: 0.6, y: -0.6 + (1.2 * i / 40)});
  for ( let i = 0; i <= 40; i++ ) stroke.push({x: 0.6 - (1.2 * i / 40), y: 0.6});
  for ( let i = 0; i <= 40; i++ ) stroke.push({x: -0.6, y: 0.6 - (1.2 * i / 40)});
  const drawn = O.freehandOutline(stroke);
  ok(drawn?.nodes.length === 4 && drawn.nodes.every(n => n.smooth === 0), `a square drawn by hand becomes four sharp corners (${drawn?.nodes.length})`);
  const wobble = Array.from({length: 90}, (_, i) => ({x: Math.cos(i * Math.PI / 45) * 0.7, y: Math.sin(i * Math.PI / 45) * 0.7}));
  const blob = O.freehandOutline(wobble);
  ok(blob && blob.nodes.length >= 6 && blob.nodes.every(n => n.smooth === 1), `a circle drawn by hand stays round (${blob?.nodes.length} points)`);
  ok(O.freehandOutline([{x: 0, y: 0}, {x: 0.01, y: 0.01}, {x: 0.02, y: 0}]) === null, "a tiny scribble isn't a shape");
  const lopsided = O.normalizeOutline({nodes: [{x: -0.8, y: -0.5}, {x: 0.3, y: -0.9}, {x: 0.6, y: 0.7, smooth: 1}, {x: -0.4, y: 0.8, smooth: 1}]});
  const mir = O.mirrorOutline(lopsided);
  ok(mir.nodes.length === 4 && mir.nodes.every(n => mir.nodes.some(m => Math.abs(m.x + n.x) < 1e-9 && Math.abs(m.y - n.y) < 1e-9)), "Mirror makes the outline symmetric");

  // Looks and the shader
  const holy = Library.get("particles", "builtin-holy-seal");
  const molded = normalizePreset({...holy, outline: O.outlineShape("square")});
  ok(molded.outline?.nodes.length === 4 && normalizePreset(holy).outline === null, "particles carry their outline (none for a plain one)");
  ok(visualKey(normalizePreset(holy)) === JSON.stringify([holy.kind, holy.palette, holy.seed, holy.look, holy.res]) && visualKey(molded) !== visualKey(normalizePreset(holy)),
    "a molded look gets images of its own; plain looks keep the ones they had");
  const {createParticleMesh, updateParticleMesh} = await imp("shader.js");
  ok(/uniform sampler2D uProfile;/.test(FRAGMENT) && /p0 \/ max\(outlineRadius\(p0\), 0\.02\)/.test(FRAGMENT), "the shader stretches space to the outline");
  const mesh = createParticleMesh(molded, 64);
  const prof = mesh.shader.uniforms.uProfile;
  ok(mesh.shader.uniforms.uMolded === 1 && prof && (prof.width === O.PROFILE_SIZE) && (prof.options.scaleMode === PIXI.SCALE_MODES.NEAREST)
    && (prof.options.mipmap === PIXI.MIPMAP_MODES.OFF) && Math.abs(O.decodeProfile(prof.data, 0) - O.radialProfile(molded.outline)[0]) < 1e-4,
  "the mesh hands the outline to the shader (exact texels, no mipmaps)");
  const uploadsBefore = prof.uploads;
  updateParticleMesh(mesh, {...molded, outline: O.outlineShape("star")});
  ok(mesh.shader.uniforms.uProfile === prof && prof.uploads === uploadsBefore + 1, "a new outline is written into the same texture");
  updateParticleMesh(mesh, {...molded, outline: O.outlineShape("star")});
  ok(prof.uploads === uploadsBefore + 1, "(only when it changed)");
  updateParticleMesh(mesh, normalizePreset(holy));
  ok(mesh.shader.uniforms.uMolded === 0, "a plain look switches molding off");
  mesh.destroy();
  ok(prof.destroyedFlag && mesh.destroyed, "the outline texture goes with its mesh");

  // Live editing on the map: one texture per token, changed in place
  const {LiveTextures} = await imp("textures.js");
  const {ParticleTokens} = await imp("tokens.js");
  const sealId = (await api.spawn("Holy seal", {x: 1500, y: 1500}))[0];
  const seal = scene.tokens.get(sealId);
  const sizeBefore = LiveTextures.size;
  ParticleTokens.previewLook([sealId], {...holy, outline: O.outlineShape("hexagon")});
  const editTex = seal.object.mesh.texture;
  ParticleTokens.previewLook([sealId], {...holy, outline: O.outlineShape("star")});
  ParticleTokens.previewLook([sealId], {...holy, outline: O.outlineShape("heart")});
  ok(seal.object.mesh.texture === editTex && LiveTextures.size === sizeBefore + 1, "editing a look on the map reuses one texture (no pile-up while dragging)");
  ParticleTokens.previewLook([sealId], null);
  ok(seal.object.mesh.texture !== editTex, "and the token goes back to its own look");

  // The studio: outline tools over the preview
  const {ParticleStudio} = await imp("studio.js");
  const stpl = Handlebars.compile(readFileSync(ROOT + "templates/studio.hbs", "utf8"));
  const st = new ParticleStudio();
  st.render = function() { return this; };
  const sl = {};
  st.element = {addEventListener: (t, fn, capture) => { if ( !capture ) sl[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await st._onFirstRender({}, {});
  ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(st, {}, {dataset: {tab: "particles"}});
  ParticleStudio.DEFAULT_OPTIONS.actions.selectItem.call(st, {}, {closest: () => ({dataset: {id: "builtin-holy-seal"}})});
  await new Promise(r => setTimeout(r, 5));
  let sctx = await st._prepareContext({});
  const shtml = stpl(sctx);
  ok(sctx.item.id === "builtin-holy-seal" && /name="moldShape"/.test(shtml) && /data-action="moldToggle"/.test(shtml) && sctx.editor.outline.molded === false,
    "the studio has the outline tools");
  const moldAct = action => ParticleStudio.DEFAULT_OPTIONS.actions[action].call(st, {}, {dataset: {action}});
  sl.change({target: {name: "moldShape", value: "square", type: "select-one", dataset: {}, closest: () => null}});
  sctx = await st._prepareContext({});
  ok(sctx.item.outline?.nodes.length === 4 && sctx.dirty && sctx.editor.outline.molding && sctx.item.name === "Holy seal",
    "starting from a shape molds the look (and shows its points)");
  moldAct("moldRound");
  sctx = await st._prepareContext({});
  ok(sctx.item.outline.nodes.every(n => n.smooth === 1), "Curves rounds every point");
  moldAct("moldReset");
  sctx = await st._prepareContext({});
  ok(sctx.item.outline === null, "Circle goes back to the plain look");
  // The editor itself, driven like a mouse would
  const {OutlineEditor} = await imp("outline-editor.js");
  const svgKids = [];
  const svg = {
    setAttribute() {}, classList: {add() {}, remove() {}, toggle() {}}, addEventListener(t, fn) { this[`on${t}`] = fn; },
    replaceChildren(...c) { svgKids.length = 0; svgKids.push(...c); }, append(...c) { svgKids.push(...c); }, remove() {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 200, height: 200}), setPointerCapture() {}, releasePointerCapture() {}
  };
  const savedDocument = globalThis.document;
  globalThis.document = {...savedDocument, createElementNS: (ns, name) => (name === "svg" ? svg : {name, attrs: {}, dataset: {}, setAttribute(k, v) { this.attrs[k] = v; if ( k === "data-index" ) this.dataset.index = v; }})};
  let edited = null;
  const finals = [];
  const host = {classList: {add() {}, remove() {}}, append() {}};
  const ed = new OutlineEditor(host, {get: () => edited, set: (o, final) => { edited = o; if ( final ) finals.push(o); }});
  const nodeEls = () => svgKids.filter(k => k.dataset?.index !== undefined);
  ok(nodeEls().length === 8, "a plain particle shows the eight points of its circle");
  // Drag the right-hand point (index 2 at (0.97, 0): 197 px) to the bottom-right corner
  const right = nodeEls().find(k => k.dataset.index === "2");
  const ev = (x, y, target = {dataset: {}}) => ({button: 0, clientX: x, clientY: y, pointerId: 1, target, preventDefault() {}});
  svg.onpointerdown(ev(197, 100, right));
  svg.onpointermove(ev(190, 190));
  ok(edited && Math.abs(edited.nodes[2].x - 0.9) < 1e-6 && Math.abs(edited.nodes[2].y - 0.9) < 1e-6 && !finals.length, "dragging a point molds it live");
  svg.onpointerup(ev(190, 190));
  ok(finals.length === 1, "and letting go finishes the change");
  // Pull the top edge (between points 0 and 1) up into a new corner
  svg.onpointerdown(ev(140, 12));
  svg.onpointermove(ev(150, 2));
  svg.onpointerup(ev(150, 2));
  ok(edited.nodes.length === 9 && finals.length === 2, "pulling an edge adds a new point there");
  // A click with a tiny jitter changes nothing; a double-click on a point turns it sharp; a right-click removes it.
  // (The clicks of a captured pointer land on the editor itself, so points are found where they are.)
  const finalsBefore = finals.length;
  svg.onpointerdown(ev(100, 3, svg));
  svg.onpointermove(ev(101, 3));
  svg.onpointerup(ev(101, 3));
  ok(finals.length === finalsBefore && edited.nodes.length === 9, "a click on a point (with a little jitter) changes nothing");
  svg.ondblclick({...ev(100, 3, svg), preventDefault() {}});
  ok(edited.nodes[0].smooth === 0 && edited.nodes.length === 9, "double-clicking a point makes it a sharp corner (and adds nothing)");
  svg.oncontextmenu({...ev(100, 3, svg), preventDefault() {}});
  ok(edited.nodes.length === 8, "right-clicking a point removes it");
  // A point moves with the pointer from where it was grabbed (not snapped to it)
  const n5 = edited.nodes[5];
  const cx = ((n5.x + 1) / 2) * 200;
  const cy = ((n5.y + 1) / 2) * 200;
  svg.onpointerdown(ev(cx + 4, cy, svg));
  svg.onpointermove(ev(cx + 14, cy));
  svg.onpointerup(ev(cx + 14, cy));
  ok(Math.abs(edited.nodes[5].x - (n5.x + 0.1)) < 1e-6 && Math.abs(edited.nodes[5].y - n5.y) < 1e-6, "a dragged point keeps where it was grabbed");
  // Drawing the outline by hand
  ed.startDrawing();
  svg.onpointerdown(ev(40, 40));
  for ( let i = 0; i <= 30; i++ ) svg.onpointermove(ev(40 + (i * 4), 40));
  for ( let i = 0; i <= 30; i++ ) svg.onpointermove(ev(160, 40 + (i * 4)));
  for ( let i = 0; i <= 30; i++ ) svg.onpointermove(ev(160 - (i * 4), 160));
  for ( let i = 0; i <= 30; i++ ) svg.onpointermove(ev(40, 160 - (i * 4)));
  svg.onpointerup(ev(40, 42));
  ok(!ed.drawing && edited.nodes.length >= 4 && edited.nodes.length <= 6, `a drawn outline replaces the old one (${edited.nodes.length} points)`);
  ed.destroy();
  globalThis.document = savedDocument;

  // The manager: mold the selected particles, live, then Apply (one undo step)
  const {ParticleManager} = await imp("manager.js");
  const mtpl = Handlebars.compile(readFileSync(ROOT + "templates/manager.hbs", "utf8"));
  const man = ParticleManager.open({tokens: [sealId]});
  man.render = function() { return this; };
  const ml = {};
  man.element = {addEventListener: (t, fn, capture) => { if ( !capture ) ml[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await man._onFirstRender({}, {});
  ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab: "look"}});
  let mctx = await man._prepareContext({});
  ok(/name="moldShape"/.test(mtpl(mctx)) && mctx.look.outline, "the manager's Look tab has the outline tools");
  await ml.change({target: {name: "moldShape", value: "arch", type: "select-one", dataset: {}, closest: () => null}});
  ok(seal.object.mesh.texture && ParticleTokens.previewing.includes(sealId) && !seal.flags[MOD].particle.preset.outline,
    "molding shows on the map at once (for you), before it is applied");
  kfp.history.clear();
  await ParticleManager.DEFAULT_OPTIONS.actions.applyLook.call(man);
  const applied = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset);
  ok(applied.outline?.nodes.length === O.outlineShape("arch").nodes.length && !ParticleTokens.previewing.includes(sealId), "Apply makes the new outline the particle's own");
  await kfp.history.undo();
  ok(!normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline, "and Ctrl+Z puts the circle back");
  man._onClose({});

  // The Mold tool, on the map
  const {MoldTool} = await imp("mold-tool.js");
  const overlay = new Display();
  canvas.kfpHub = {overlay: () => overlay};
  const H = MoldTool.handlers;
  H.activate();
  H.click({}, {x: 1500, y: 1500});
  ok(MoldTool.target?.id === sealId, "clicking a particle picks it for molding");
  const gfx = overlay.children[0];
  ok(gfx && gfx.ops.filter(o => o[0] === "circle").length === 8, "its outline's points are drawn on the map");
  // The seal is 2 squares (200 px) at 1400..1600: its right-hand point is at (1597, 1500)
  kfp.history.clear();
  H.dragStart({}, {x: 1597, y: 1500});
  H.dragMove({}, {x: 1590, y: 1590});
  ok(ParticleTokens.previewing.includes(sealId) && gfx.ops.filter(o => o[0] === "circle").length === 8, "dragging a point shows the new shape at once");
  await H.dragDrop({}, {x: 1590, y: 1590});
  let mo = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline;
  ok(mo && Math.abs(mo.nodes[2].x - 0.9) < 1e-6 && Math.abs(mo.nodes[2].y - 0.9) < 1e-6 && kfp.history.peek()?.label.startsWith("KPE.Undo.Mold ")
    && !ParticleTokens.previewing.includes(sealId), "letting go saves the shape for everyone (one undo step)");
  ok(String(scene.tokens.get(sealId).texture.src).includes("rune-holy-seal"), "with an image of the new shape");
  // A double-click on an edge adds a point, on a point turns it; a right-click removes it
  // (the middle of the arc between the top point and the one before it)
  await H.doubleClick({}, {x: 1500 + (Math.cos(-5 * Math.PI / 8) * 97), y: 1500 + (Math.sin(-5 * Math.PI / 8) * 97)});
  mo = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline;
  ok(mo.nodes.length === 9, "double-clicking the outline adds a point");
  const topIdx = mo.nodes.findIndex(n => Math.abs(n.x) < 0.05 && n.y < -0.9);
  const topW = {x: 1500 + (mo.nodes[topIdx].x * 100), y: 1500 + (mo.nodes[topIdx].y * 100)};
  await H.doubleClick({}, topW);
  mo = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline;
  ok(mo.nodes[topIdx].smooth === 0, "double-clicking a point makes it a corner");
  await H.rightClick({}, topW);
  mo = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline;
  ok(mo.nodes.length === 8, "right-clicking a point removes it");
  // Dragging inside moves the whole outline
  const before = mo.nodes.map(n => n.x);
  H.dragStart({}, {x: 1480, y: 1480});
  H.dragMove({}, {x: 1470, y: 1480});
  await H.dragDrop({}, {x: 1470, y: 1480});
  mo = normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline;
  const shift = mo.nodes.map((n, i) => n.x - before[i]);
  ok(shift.every(d => Math.abs(d - shift[0]) < 1e-6) && (shift[0] < 0) && (Math.min(...mo.nodes.map(n => n.x)) >= -1),
    "dragging inside moves the whole outline (as far as the square allows)");
  // Undo, step by step
  await kfp.history.undo();
  await kfp.history.undo();
  await kfp.history.undo();
  await kfp.history.undo();
  await kfp.history.undo();
  ok(!normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline, "Ctrl+Z undoes each change, back to the circle");
  // Players only mold their own particles
  H.click({}, {x: 3000, y: 3000});
  ok(MoldTool.target === null, "clicking empty ground lets go");
  game.user = worldPlayer;
  H.click({}, {x: 1500, y: 1500});
  const playerPick = MoldTool.target;
  game.user = me;
  ok(playerPick === null, "players can't mold particles they don't control");
  H.deactivate();
  ok(gfx.ops.length === 0, "leaving the tool takes the points away");
  H.activate();
  H.click({}, {x: 1500, y: 1500});
  H.dragStart({}, {x: 1597, y: 1500});
  H.dragMove({}, {x: 1580, y: 1560});
  const stillSaving = H.dragDrop({}, {x: 1580, y: 1560});
  H.deactivate();
  await stillSaving;
  ok(gfx.ops.length === 0 && normalizePreset(scene.tokens.get(sealId).flags[MOD].particle.preset).outline,
    "a change still being saved when the tool is put away is saved, and draws no points afterwards");
  await kfp.history.undo();
  delete canvas.kfpHub;
  await api.despawn([sealId]);
}

const kaaApi = () => modules[KAA].api;
/* ---------------- Effect walls ---------------- */
{
  const geo = await imp("wall-geometry.js");
  const {BUILTIN_WALLS, normalizeWall, normalizeReveal, standsComplete} = await imp("wall-presets.js");
  const {LINE_FRAGMENT, lineUniforms, LINE_STYLES} = await imp("line-shader.js");
  const history = kfp.history;
  // Geometry
  const sq = [];
  for ( const [x, y] of [[0, 0], [400, 0], [400, 200], [0, 200], [0, 0]] ) sq.push(x, y);
  const dense = (pts, step = 10) => { const out = []; for ( let i = 0; i < pts.length - 2; i += 2 ) { const n = Math.ceil(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) / step); for ( let k = 0; k < n; k++ ) out.push(pts[i] + (pts[i + 2] - pts[i]) * k / n, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * k / n); } out.push(pts.at(-2), pts.at(-1)); return out; };
  const room = geo.measureTrack([{points: dense(sq), closed: true}]);
  ok(Math.abs(room.length - 1200) < 1e-6 && room.closed, "a drawn room measures its perimeter and is a loop");
  const two = geo.measureTrack([{points: [0, 0, 100, 0], closed: false}, {points: [100, 0, 100, 50], closed: false}]);
  ok(two.length === 150 && !two.closed && two.pieces[1].start === 100, "pieces share one distance axis");
  const p = geo.trackPoint(room, 500);
  const p2 = geo.trackPoint(room, 700);
  ok(Math.abs(p.x - 400) < 1e-6 && Math.abs(p.y - 100) < 1e-6 && Math.abs(p2.x - 300) < 1e-6 && Math.abs(p2.y - 200) < 1e-6, `points along the track (${p.x}, ${p.y})`);
  ok(Math.abs(geo.trackPoint(room, 1300).x - 100) < 1e-6, "loops wrap");
  const pr = geo.projectOnTrack(room, {x: 390, y: 120});
  ok(Math.abs(pr.u - 520) < 1e-6 && Math.abs(pr.distance - 10) < 1e-6, "tokens project onto the nearest point of the track");
  const rib = geo.ribbon(room.pieces[0], 30);
  ok(rib.positions.length === (room.pieces[0].points.length / 2) * 4 && rib.indices.length === ((room.pieces[0].points.length / 2) - 1) * 6, "ribbons have two vertices per point");
  ok([...rib.positions].every(Number.isFinite), "ribbon vertices are finite");
  let folds = 0;
  const pts = room.pieces[0].points;
  for ( let side = 0; side < 2; side++ ) {
    for ( let i = 1; i < pts.length / 2; i++ ) {
      const dx = pts[2 * i] - pts[(2 * i) - 2];
      const dy = pts[(2 * i) + 1] - pts[(2 * i) - 1];
      const ax = rib.positions[(i * 4) + (side * 2)] - rib.positions[((i - 1) * 4) + (side * 2)];
      const ay = rib.positions[(i * 4) + (side * 2) + 1] - rib.positions[((i - 1) * 4) + (side * 2) + 1];
      if ( (ax * dx) + (ay * dy) < -1e-6 ) folds++;
    }
  }
  ok(folds === 0, "neither edge of the ribbon ever doubles back (clean corners)");
  // Reveal windows
  const R = (r, extra) => geo.revealWindow(normalizeReveal(r), {length: 1000, closed: false, grid: 100, ...extra});
  ok(R({mode: "full"}).span === 1000, "full: everything");
  ok(Math.abs(R({mode: "grow", duration: 4}, {elapsed: 1}).span - 250) < 1e-6 && R({mode: "grow", duration: 4}, {elapsed: 1}).front === 1, "grow: a quarter after a quarter of the time, with a bright front");
  ok(R({mode: "grow", duration: 4}, {elapsed: 9}).span === 1000, "grow then stay");
  ok(Math.abs(R({mode: "grow", duration: 4, then: "loop", hold: 1}, {elapsed: 6}).span - 250) < 1e-6, "grow then start over");
  const faded = R({mode: "grow", duration: 4, then: "fade", hold: 1, fade: 2}, {elapsed: 6});
  ok(Math.abs(faded.alpha - 0.5) < 1e-6, "grow then fade");
  const back = R({mode: "grow", duration: 4, direction: "backward"}, {elapsed: 1});
  ok(Math.abs(back.a - 750) < 1e-6 && Math.abs(back.span - 250) < 1e-6, "backward grows from the far end");
  ok(back.back === true && back.front === 1 && R({mode: "grow", duration: 4}, {elapsed: 1}).back === false,
    "and knows its moving edge is at its start (so the bright front is on the moving end)");
  ok(lineUniforms({...BUILTIN_WALLS[0].look, widthPx: 40}, back, {length: 1000, closed: false}).uBack === 1, "(the shader is told)");
  const train = geo.revealWindow(normalizeReveal({mode: "train", length: 3, speed: 2}), {length: 1200, closed: true, grid: 100, elapsed: 7});
  ok(Math.abs(train.span - 300) < 1e-6 && Math.abs(train.a - 1100) < 1e-6 && train.taper > 0, `train: a 3-square window running round the loop (a=${train.a})`);
  const trail = R({mode: "follow", length: 2}, {head: 600});
  ok(trail.a === 400 && trail.span === 200, "follow: a trail behind the token");
  ok(R({mode: "follow", length: 0}, {head: 600, cycles: 0}).span === 600 && R({mode: "follow", length: 0}, {head: 100, cycles: 1}).span === 1000, "ignite: everything behind it, all of it after a lap");
  ok(R({mode: "follow"}, {head: null}).alpha === 0, "no token, no wall");
  // Real-wall segments
  const segs = geo.wallSegments(room, 6);
  ok(segs.length === 4 && segs.every(c => c.every(Number.isInteger)), `a room becomes four straight walls (${segs.length})`);
  // Presets & shader
  const emitterIds = new Set(BUILTIN_EMITTERS.map(e => e.id));
  ok(BUILTIN_WALLS.length >= 14 && BUILTIN_WALLS.every(w => w.id.startsWith("builtin-") && (!w.emitter || emitterIds.has(w.emitter))), `${BUILTIN_WALLS.length} built-in walls with valid emitters`);
  ok(Object.keys(LINE_STYLES).every(st => BUILTIN_WALLS.some(w => w.look.style === st)), "every style has a built-in wall");
  const lu = [...LINE_FRAGMENT.matchAll(/uniform \w+ (\w+);/g)].map(m => m[1]);
  ok(lu.every(u => u in lineUniforms({...BUILTIN_WALLS[0].look, widthPx: 40}, null, room)), `every wall shader uniform is supplied (${lu.length})`);
  ok(standsComplete(normalizeWall({reveal: {mode: "full"}}), 0) && !standsComplete(normalizeWall({reveal: {mode: "train"}}), 99)
    && standsComplete(normalizeWall({reveal: {mode: "grow", duration: 3}}), 3.5) && !standsComplete(normalizeWall({reveal: {mode: "grow", duration: 3, then: "loop"}}), 9), "real walls only for walls that stand complete");

  // Runtime: a path, a wall on it, drawing, blocking, undo
  const {EffectWalls, EffectWallBlocks, sceneWalls} = await imp("effect-walls.js");
  await api.clearScene();
  history.clear();
  const roomAnim = await kaaApi().createAnimation({name: "Room", steps: [{shape: {type: "rect", cx: 1200, cy: 900, w: 400, h: 200, rotation: 0}}]});
  const wall = await api.walls.attach("Sealing chains", roomAnim.id);
  ok(wall && sceneWalls(scene).length === 1 && wall.look.style === "chains" && wall.blocks === "move" && wall.source.animId === roomAnim.id, "a wall is put along an existing path");
  EffectWalls.sync();
  const box = canvas.primary.children.filter(c => c instanceof PrimaryCanvasParticleContainer && !c.destroyed).at(-1);
  ok(EffectWalls.size === 1 && box.children.length === 1 && box.sortLayer === 690, "it is drawn under tokens as a ribbon");
  const mesh = box.children[0];
  ok(mesh.shader.uniforms.uStyle === 1 && mesh.shader.uniforms.uClosed === 1 && Math.abs(mesh.shader.uniforms.uLength - 1200) < 1e-6, "with its style, a closed loop of the right length");
  await EffectWallBlocks.sync(scene);
  const blockers = scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === wall.id);
  ok(blockers.length === 4 && blockers.every(w => w.move === 20 && w.sight === 0), `the GM makes ${blockers.length} movement walls for it`);
  ok(sceneOps.filter(o => o.type === "Wall").every(o => o.options.kfpNoHistory), "real walls stay out of Ctrl+Z");
  const opsBefore = sceneOps.length;
  await EffectWallBlocks.sync(scene);
  ok(sceneOps.length === opsBefore, "nothing is redone when nothing changed");
  scene.walls.delete(blockers[0].id);
  await EffectWallBlocks.sync(scene);
  ok(scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === wall.id).length === 4, "a real wall deleted by hand is put back");
  await api.walls.update(wall.id, {blocks: "all"});
  await EffectWallBlocks.sync(scene);
  ok(scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === wall.id).every(w => w.sight === 20 && w.move === 20), "changing what it blocks rebuilds the walls");
  await history.undo();
  await EffectWallBlocks.sync(scene);
  ok(sceneWalls(scene)[0].blocks === "move" && scene.walls.filter(w => w.flags?.[MOD]?.effectWall).every(w => w.sight === 0), "undo puts it back");
  // Live editing on this client only
  const genW = generators.length;
  EffectWalls.preview(wall.id, {look: {style: "fire"}, emitter: "builtin-embers", emitterRate: 25});
  ok(generators.length === genW + 1, "previewing an emitter on it starts one");
  const live = canvas.primary.children.filter(c => c instanceof PrimaryCanvasParticleContainer && !c.destroyed).at(-1).children[0];
  ok(live.shader.uniforms.uStyle === 0 && sceneWalls(scene)[0].look.style === "chains", "previewing a change draws it here without saving it");
  const emberGen = generators.at(-1);
  ok(emberGen.started && emberGen.particlesContainer.sortLayer === 691 && emberGen.cfg.elevation === 0, "a fire wall's embers rise just over the wall");
  EffectWalls.preview(wall.id, null);
  ok(emberGen.stopped === "hard", "and stop when it changes back");
  // Grow: real walls only once complete
  const fuse = await api.walls.attach("Burning fuse", roomAnim.id);
  await api.walls.update(fuse.id, {blocks: "move"});
  await EffectWallBlocks.sync(scene);
  ok(!scene.walls.some(w => w.flags?.[MOD]?.effectWall?.id === fuse.id), "a growing wall doesn't block yet");
  NOW += 7000;
  await EffectWallBlocks.sync(scene);
  ok(scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === fuse.id).length === 4, "and blocks once it has grown");
  // Follow a token
  const runner = (await scene.createEmbeddedDocuments("Token", [{name: "Runner", x: 1150, y: 750}]))[0];
  const trailW = await api.walls.attach("Fire trail", roomAnim.id);
  await api.walls.update(trailW.id, {reveal: {token: runner.id}});
  EffectWalls.sync();
  const win = EffectWalls.windowOf(trailW.id);
  // the room path starts at its top-left corner and runs clockwise: the token is 200px along, its 4-square trail wraps
  ok(win && Math.abs(((win.a + win.span) % 1200) - 200) < 1 && Math.abs(win.span - 400) < 1 && Math.abs(win.a - 1000) < 1, `a trail ends where the token is on the path (${win?.a.toFixed(1)} + ${win?.span.toFixed(1)})`);
  // A token hidden by the GM leaves no trail for players
  runner.hidden = true;
  me.isGM = false;
  const hiddenWin = EffectWalls.windowOf(trailW.id);
  me.isGM = true;
  ok(hiddenWin && hiddenWin.alpha === 0 && EffectWalls.windowOf(trailW.id).alpha === 1, "a GM-hidden token leaves no trail for players (the GM still sees it)");
  runner.hidden = false;
  // Levels (v14): a wall on another level isn't drawn, and its real walls are on its level only
  canvas.level = {id: "L1", visibility: {levels: new Set()}};
  await api.walls.update(wall.id, {level: "L2"});
  EffectWalls.sync();
  ok(!EffectWalls.windowOf(wall.id), "a wall on another level isn't drawn");
  canvas.level.visibility.levels.add("L2");
  EffectWalls.sync();
  ok(EffectWalls.windowOf(wall.id), "unless that level can be seen from this one");
  await EffectWallBlocks.sync(scene);
  ok(scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === wall.id).every(w => w.levels?.length === 1 && w.levels[0] === "L2"),
    "its real walls only block on its own level");
  await api.walls.update(wall.id, {level: null});
  delete canvas.level;
  await EffectWallBlocks.sync(scene);
  ok(scene.walls.filter(w => w.flags?.[MOD]?.effectWall?.id === wall.id).every(w => !w.levels), "(and on every level again without one)");
  // Real walls are kept up on scenes the GM isn't viewing
  const s2 = new SceneDoc("S2");
  await s2.update({flags: {[MOD]: {walls: {W2: {name: "Elsewhere", look: {style: "chains"}, reveal: {mode: "full"}, blocks: "move", source: {animId: roomAnim.id}}}}}});
  await new Promise(r => setTimeout(r, 250));
  ok(s2.walls.size === 4, `walls changed on another scene get their real walls too (${s2.walls.size})`);
  // Embers only come off the part of the path that shows (an open path's ends don't collect them)
  {
    const line = await kaaApi().createAnimation({name: "Line", steps: [{shape: {type: "path", closed: false, nodes: [{x: 0, y: 3000}, {x: 1000, y: 3000}]}}]});
    const lw = await api.walls.attach("Wall of fire", line.id);
    await api.walls.update(lw.id, {reveal: {mode: "train", length: 4, speed: 2, then: "loop", start: NOW - 500}});
    EffectWalls.sync();
    const gen = generators.at(-1);
    const tickW = tickerFns.find(t => t.ctx === EffectWalls);
    const realNow = performance.now;
    let fakeNow = realNow.call(performance);
    performance.now = () => fakeNow;
    try {
      for ( let i = 0; i < 60; i++ ) { fakeNow += 100; tickW.fn.call(tickW.ctx); }
    } finally {
      performance.now = realNow;
    }
    const xs = (gen.at ?? []).map(q => q.x);
    const atEnd = xs.filter(x => (x < 1) || (x > 999)).length;
    ok(xs.length > 10 && xs.every(x => (x >= -1e-6) && (x <= 100 + 1e-6)) && (atEnd / xs.length < 0.15),
      `embers come off the part that shows (${xs.length}, ${atEnd} at the very end)`);
    // One broken wall never stops the canvas (PIXI only asks for the next frame once every ticker function returns)
    const realStatus = kaaApi().status;
    kaaApi().status = () => { throw new Error("broken path"); };
    let threw = false;
    const errs = console.error;
    console.error = () => {};
    try { tickW.fn.call(tickW.ctx); } catch(err) { threw = true; } finally { kaaApi().status = realStatus; console.error = errs; }
    ok(!threw, "a wall that fails while drawing doesn't take the canvas down with it");
    await api.walls.remove(lw.id, {withPath: true});
  }
  // Draw a new wall
  const drawn = await api.walls.draw("Wall of fire", {tool: "freehand"});
  ok(drawn && draws.at(-1).tool === "freehand" && kaaAnims.has(drawn.source.animId), "drawing a wall makes an empty path and hands over to the animator's freehand tool");
  await history.undo();
  ok(!sceneWalls(scene).some(w => w.id === drawn.id) && !kaaAnims.has(drawn.source.animId), "undo removes both the wall and its new path");
  // Remove with path, undo
  await api.walls.remove(wall.id, {withPath: true});
  ok(!sceneWalls(scene).some(w => w.id === wall.id) && !kaaAnims.has(roomAnim.id), "a wall can be removed together with its path");
  await EffectWallBlocks.sync(scene);
  ok(!scene.walls.some(w => w.flags?.[MOD]?.effectWall?.id === wall.id), "its real walls go too");
  await history.undo();
  ok(sceneWalls(scene).some(w => w.id === wall.id) && kaaAnims.has(roomAnim.id), "undo brings back the wall and its path");
  // Managers
  const hb = {eq: (a, b) => a === b, not: v => !v};
  for ( const [k, f] of Object.entries(hb) ) Handlebars.registerHelper(k, f);
  Handlebars.registerPartial("modules/kostis-particle-effects/templates/wall-editor.hbs", readFileSync(ROOT + "templates/wall-editor.hbs", "utf8"));
  const wtpl = Handlebars.compile(readFileSync(ROOT + "templates/walls.hbs", "utf8"));
  const {WallManager} = await imp("wall-manager.js");
  const wm = WallManager.open({wall: wall.id});
  wm.render = function() { return this; };
  let ctx = await wm._prepareContext({});
  let html = wtpl(ctx);
  ok(ctx.rows.length === 3 && ctx.wall?.id === wall.id && /name="look.style"/.test(html) && /name="reveal.mode"/.test(html), "the walls manager lists the walls and edits the selected one");
  const used = [...(readFileSync(ROOT + "templates/walls.hbs", "utf8") + readFileSync(ROOT + "templates/wall-editor.hbs", "utf8")).matchAll(/data-action="([^"{]+)"/g)].map(m => m[1]);
  const missing = used.filter(a => !(a in WallManager.DEFAULT_OPTIONS.actions));
  ok(!missing.length, `every walls-manager button is wired${missing.length ? ": missing " + missing.join(", ") : ""}`);
  const listeners = {};
  wm.element = {addEventListener: (t, fn, capture) => { if ( !capture ) listeners[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await wm._onFirstRender({}, {});
  listeners.input({target: {name: "look.palette.1", value: "#00ff00", type: "color", dataset: {}, closest: () => null}});
  ctx = await wm._prepareContext({});
  ok(ctx.wall.dirty && ctx.wall.w.palette[1].value === "#00ff00" && ctx.wall.w.palette[0].value === wall.look.palette[0], "editing one colour keeps the rest of the palette");
  await WallManager.DEFAULT_OPTIONS.actions.apply.call(wm);
  ok(sceneWalls(scene).find(w => w.id === wall.id).look.palette[1] === "#00ff00", "Apply saves the edit for everyone");
  await listeners.change({target: {name: "reveal.mode", value: "train", type: "select-one", dataset: {}, closest: () => null}});
  ctx = await wm._prepareContext({});
  html = wtpl(ctx);
  ok(ctx.wall.w.isTrain && /name="reveal.speed"/.test(html), "changing how it appears shows that mode's settings");
  // "Start from": the preset chosen is the one used
  await listeners.change({target: {name: "loadPreset", value: "builtin-wall-of-ice", type: "select-one", dataset: {}, closest: () => null}});
  ctx = await wm._prepareContext({});
  ok(ctx.presetsForLoad.find(o => o.selected)?.value === "builtin-wall-of-ice", "the preset chosen under Start from stays chosen");
  wm.element.querySelector = () => ({value: "builtin-wall-of-fire"});
  await WallManager.DEFAULT_OPTIONS.actions.loadPreset.call(wm);
  ctx = await wm._prepareContext({});
  ok(ctx.wall.w.styles.find(o => o.selected)?.value === "frost", "and Use loads that one");
  // Picking another wall drops this one's unsaved edits (and stops showing them on the map)
  const previews = [];
  const realPreview = EffectWalls.preview;
  EffectWalls.preview = function(id, partial) { previews.push([id, partial]); return realPreview.call(this, id, partial); };
  const otherWall = sceneWalls(scene).find(w => w.id !== wall.id);
  await WallManager.DEFAULT_OPTIONS.actions.pickRow.call(wm, {}, {closest: () => ({dataset: {wall: otherWall.id}})});
  EffectWalls.preview = realPreview;
  await WallManager.DEFAULT_OPTIONS.actions.pickRow.call(wm, {}, {closest: () => ({dataset: {wall: wall.id}})});
  ctx = await wm._prepareContext({});
  ok(previews.some(([id, partial]) => (id === wall.id) && (partial === null)) && !ctx.wall.dirty, "picking another wall drops the unsaved edits and their preview");
  me.isGM = false;
  ok(WallManager.open() === null, "players can't open the walls manager");
  me.isGM = true;
  wm._onClose({});
  // Studio walls tab
  const {ParticleStudio} = await imp("studio.js");
  const stpl = Handlebars.compile(readFileSync(ROOT + "templates/studio.hbs", "utf8"));
  const st = new ParticleStudio();
  st.render = function() { return this; };
  ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(st, {}, {dataset: {tab: "walls"}});
  const sctx = await st._prepareContext({});
  const shtml = stpl(sctx);
  ok(sctx.cards.length === BUILTIN_WALLS.length && /data-action="drawWall"/.test(shtml) && /name="look.width"/.test(shtml), "the studio has a Walls tab with every style");
  const sused = [...readFileSync(ROOT + "templates/studio.hbs", "utf8").matchAll(/data-action="([^"{]+)"/g)].map(m => m[1]);
  ok(sused.every(a => a in ParticleStudio.DEFAULT_OPTIONS.actions), "every studio button is still wired");
  await api.clearScene();
}

/* ---------------- Seals: wall layers, rune circles stretched over rooms ---------------- */
{
  const geo = await imp("wall-geometry.js");
  const {BUILTIN_WALLS, MAX_LAYERS, normalizeLayer, normalizeLook} = await imp("wall-presets.js");
  const {partMeshes, updateWallParts, wallParts} = await imp("wall-render.js");
  const {EffectWalls, sceneWalls} = await imp("effect-walls.js");
  const dense = (corners, step = 10) => {
    const out = [];
    for ( let i = 0; i < corners.length; i++ ) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % corners.length];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
      for ( let k = 0; k < n; k++ ) out.push(ax + ((bx - ax) * k / n), ay + ((by - ay) * k / n));
    }
    out.push(corners[0][0], corners[0][1]);
    return out;
  };
  const corners = [[0, 0], [400, 0], [400, 400], [0, 400]];
  const room = geo.measureTrack([{points: dense(corners), closed: true}]);
  const ccwRoom = geo.measureTrack([{points: dense([...corners].reverse()), closed: true}]);
  const xsOf = t => t.pieces.flatMap(pc => [...pc.points].filter((_, i) => i % 2 === 0));
  const ysOf = t => t.pieces.flatMap(pc => [...pc.points].filter((_, i) => i % 2 === 1));
  // Layers
  ok(normalizeLayer({}).kind === "line" && normalizeLayer({}).style === "beam" && normalizeLayer({}).palette === null && normalizeLayer({offset: 99}).offset === 3,
    "a layer is a line beside the wall by default, in the wall's colours");
  const st = normalizeLayer({kind: "star", points: 6, step: 9, palette: ["red"]});
  ok(st.points === 6 && st.step === 3 && st.palette === null && st.inset === 0.1 && st.turn === 0, "a star's step stops where its lines would repeat");
  const pal = ["#111111", "#222222", "#333333", "#444444"];
  ok(normalizeLook({layers: Array.from({length: 9}, () => ({kind: "line"}))}).layers.length === MAX_LAYERS, `up to ${MAX_LAYERS} layers`);
  const own = normalizeLook({palette: pal, layers: [{kind: "line", ownColours: true}, {kind: "line", palette: pal, ownColours: false}]});
  ok(own.layers[0].palette?.join() === pal.join() && own.layers[1].palette === null, "a layer's own colours start from the wall's, and go back to them");
  // Lines beside a path: outside and inside a loop whichever way it runs; the right of an open path
  ok(geo.trackArea(room) > 0 && geo.trackArea(ccwRoom) < 0 && Math.abs(geo.trackCentroid(room).x - 200) < 1e-6 && Math.abs(geo.trackCentroid(ccwRoom).y - 200) < 1e-6,
    "a loop knows which way it runs and where its middle is");
  const outside = geo.offsetTrack(room, 20);
  const inside = geo.offsetTrack(ccwRoom, -20);
  ok(Math.abs(Math.min(...xsOf(outside)) + 20) < 1e-6 && Math.abs(Math.max(...ysOf(outside)) - 420) < 1e-6
    && Math.abs(Math.min(...xsOf(inside)) - 20) < 1e-6 && Math.abs(Math.max(...ysOf(inside)) - 380) < 1e-6, "+ is outside a loop and − inside, whichever way it was drawn");
  ok(outside.length === room.length && outside.pieces[0].cum === room.pieces[0].cum, "a line beside the path keeps its distances (reveals stay in step)");
  let backwards = 0;
  const ip = inside.pieces[0].points;
  const bp = ccwRoom.pieces[0].points;
  for ( let i = 1; i < ip.length / 2; i++ ) {
    const dx = bp[2 * i] - bp[(2 * i) - 2];
    const dy = bp[(2 * i) + 1] - bp[(2 * i) - 1];
    if ( (((ip[2 * i] - ip[(2 * i) - 2]) * dx) + ((ip[(2 * i) + 1] - ip[(2 * i) - 1]) * dy)) < -1e-6 ) backwards++;
  }
  ok(backwards === 0, "inside a corner the line never folds back on itself");
  // A big room drawn with the animator (a point every ~6 px), rings at distances that aren't a multiple of that
  const bigRoom = geo.measureTrack([{points: dense([[0, 0], [1000, 0], [1000, 600], [0, 600]], 6), closed: true}]);
  const lRoom = geo.measureTrack([{points: dense([[0, 0], [500, 0], [500, 300], [1000, 300], [1000, 800], [0, 800]], 6), closed: true}]);
  const nearest = (track, x, y) => {
    const P = track.pieces[0].points;
    let best = Infinity;
    for ( let j = 0; j < P.length - 2; j += 2 ) {
      const dx = P[j + 2] - P[j];
      const dy = P[j + 3] - P[j + 1];
      const l2 = (dx * dx) + (dy * dy);
      const t = l2 ? Math.max(0, Math.min(1, (((x - P[j]) * dx) + ((y - P[j + 1]) * dy)) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - P[j] - (dx * t), y - P[j + 1] - (dy * t)));
    }
    return best;
  };
  const spur = (track, d) => {
    const Q = geo.offsetTrack(track, d).pieces[0].points;
    let worst = 0;
    for ( let i = 0; i < Q.length; i += 2 ) worst = Math.max(worst, Math.abs(d) - nearest(track, Q[i], Q[i + 1]));
    return worst;
  };
  const spurs = [[bigRoom, -42], [bigRoom, -45], [bigRoom, 35], [lRoom, 35], [lRoom, -42]].map(([t, d]) => spur(t, d));
  ok(spurs.every(x => x < 0.01), `rings never poke past the corners of a room (${spurs.map(x => x.toFixed(2)).join(", ")} px)`);
  const line = geo.measureTrack([{points: [0, 0, 200, 0, 400, 0], closed: false}]);
  ok(ysOf(geo.offsetTrack(line, 15)).every(y => Math.abs(y - 15) < 1e-6), "beside an open path, + is its right");
  // Stars across a loop
  const hexagram = geo.starChords(room, {points: 6, step: 2, inset: 0});
  const first = hexagram[0].pieces[0].points;
  ok(hexagram.length === 6 && Math.abs(first[0] - 200) < 1e-6 && Math.abs(first[1]) < 1e-6, "a star's first point is straight up from the middle, on the wall");
  ok(geo.starChords(room, {points: 6, step: 3}).length === 3, "lines that would be drawn twice are drawn once");
  const drawnIn = geo.starChords(room, {points: 4, step: 1, inset: 0.5})[0].pieces[0].points;
  ok(Math.abs(drawnIn[0] - 200) < 1e-6 && Math.abs(drawnIn[1] - 100) < 1e-6, "Drawn in pulls its points towards the middle");
  const turned = geo.starChords(room, {points: 4, step: 1, turn: 90})[0].pieces[0].points;
  ok(Math.abs(turned[0] - 400) < 1e-6 && Math.abs(turned[1] - 200) < 1e-6, "Turn turns the star");
  ok(geo.starChords(line, {points: 5, step: 2}).length === 0, "an open path has no star");
  // A seal: the wall's line, its layers, its star
  const holySeal = BUILTIN_WALLS.find(w => w.id === "builtin-holy-seal");
  const seals = ["builtin-holy-seal", "builtin-arcane-seal", "builtin-infernal-seal", "builtin-druid-circle"].map(id => BUILTIN_WALLS.find(w => w.id === id));
  ok(seals.every(w => w?.look.layers.some(l => l.kind === "star")) && seals.map(w => w.look.layers.find(l => l.kind === "star").points).join() === "6,5,7,8",
    "seal walls come built in (hexagram, pentagram, heptagram, octagram)");
  const parts = wallParts(room, {...holySeal.look, widthPx: holySeal.look.width * 100}, 100);
  ok(parts.length === 4 && parts[3].kind === "star" && partMeshes(parts).length === 1 + 1 + 1 + 6, "a seal draws its band, two rings and the six lines of its star");
  updateWallParts(parts, {a: 0, span: room.length / 2, alpha: 1, taper: 0, front: 1}, 1);
  const starMesh = parts[3].meshes[0];
  const growing = starMesh.shader.uniforms.uAlpha;
  updateWallParts(parts, {a: 0, span: room.length, alpha: 1, taper: 0, front: 0}, 1);
  ok(growing === 0 && starMesh.shader.uniforms.uAlpha > 0 && parts[1].meshes[0].shader.uniforms.uRevSpan === room.length / 1,
    "the star lights up once the circle is complete; the rings grow with it");

  // On the map: drawn with every layer, rebuilt only when the shape changes
  await api.clearScene();
  kfp.history.clear();
  const roomAnim = await kaaApi().createAnimation({name: "Sealed room", steps: [{shape: {type: "rect", cx: 3000, cy: 3000, w: 400, h: 400, rotation: 0}}]});
  const seal = await api.walls.attach("Holy seal", roomAnim.id);
  EffectWalls.sync();
  const boxes = () => canvas.primary.children.filter(c => c instanceof PrimaryCanvasParticleContainer && !c.destroyed);
  const box = boxes().at(-1);
  ok(box.children.length === 9 && sceneWalls(scene).find(w => w.id === seal.id).look.layers.length === 3, "a seal on the map draws all its layers");
  await api.walls.update(seal.id, {look: {layers: seal.look.layers.map((l, i) => (i === 0 ? {...l, palette: pal} : l))}});
  EffectWalls.sync();
  ok(boxes().at(-1) === box && near(box.children[1].shader.uniforms.uC1[0], 0x22 / 255, 1e-6), "new colours for a layer change it in place");
  await api.walls.update(seal.id, {look: {layers: seal.look.layers.map((l, i) => (i === 0 ? {...l, offset: -1} : l))}});
  EffectWalls.sync();
  ok(box.destroyed && boxes().at(-1).children.length === 9, "moving a layer rebuilds the wall");

  // The walls manager: layers edited one field at a time, added and removed
  const wtpl = Handlebars.compile(readFileSync(ROOT + "templates/walls.hbs", "utf8"));
  const {WallManager} = await imp("wall-manager.js");
  const wm = WallManager.open({wall: seal.id});
  wm.render = function() { return this; };
  const wl = {};
  wm.element = {addEventListener: (t, fn, capture) => { if ( !capture ) wl[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
  await wm._onFirstRender({}, {});
  let wctx = await wm._prepareContext({});
  let whtml = wtpl(wctx);
  ok(wctx.wall.w.layers.length === 3 && /name="look.layers.2.points"/.test(whtml) && /name="look.layers.1.offset"/.test(whtml) && /data-action="addLayer"/.test(whtml),
    "the editor shows each layer's settings");
  wl.input({target: {name: "look.layers.1.width", value: "0.5", type: "range", step: "0.05", dataset: {}, closest: () => null}});
  await wl.change({target: {name: "look.layers.1.ownColours", value: "on", checked: true, type: "checkbox", dataset: {}, closest: () => null}});
  wl.input({target: {name: "look.layers.1.palette.2", value: "#abcdef", type: "color", dataset: {}, closest: () => null}});
  wctx = await wm._prepareContext({});
  const l1 = wctx.wall.w.layers[1];
  ok(l1.sliders.find(f => f.key === "look.layers.1.width").value === 0.5 && l1.own && l1.palette[2].value === "#abcdef" && l1.palette[0].value === seal.look.palette[0]
    && wctx.wall.w.layers[2].kind === "star" && wctx.wall.dirty, "one field of a layer changes, the rest of it and the other layers stay");
  await WallManager.DEFAULT_OPTIONS.actions.addLayer.call(wm, {}, {dataset: {kind: "star"}});
  await WallManager.DEFAULT_OPTIONS.actions.addLayer.call(wm, {}, {dataset: {kind: "line"}});
  wctx = await wm._prepareContext({});
  ok(wctx.wall.w.layers.length === MAX_LAYERS && !wctx.wall.w.canAddLayer, "layers can be added, up to the limit");
  await WallManager.DEFAULT_OPTIONS.actions.removeLayer.call(wm, {}, {dataset: {layer: "0"}});
  await WallManager.DEFAULT_OPTIONS.actions.apply.call(wm);
  const saved = sceneWalls(scene).find(w => w.id === seal.id);
  ok(saved.look.layers.length === 3 && saved.look.layers[0].palette?.[2] === "#abcdef" && saved.look.layers[2].kind === "star", "and removed; Apply saves them");
  // The path's points: all corners (a room) or all curves, one undo step
  const smoothed = [];
  kaaApi().setSmooth = async (id, v) => { smoothed.push([id, v]); const a = kaaAnims.get(id); kaaAnims.set(id, {...a, rev: a.rev + 1, smooth: v}); };
  kaaApi().updateAnimation = async (id, fn) => { kaaAnims.set(id, fn(structuredClone(kaaAnims.get(id)))); };
  kfp.history.clear();
  await WallManager.DEFAULT_OPTIONS.actions.pathSmooth.call(wm, {}, {dataset: {smooth: "0"}});
  ok(smoothed.at(-1)?.join() === `${roomAnim.id},0` && kaaAnims.get(roomAnim.id).smooth === 0 && kfp.history.peek()?.label.startsWith("KPE.Undo.PathCorners"),
    "Corners makes every point of the path sharp");
  await kfp.history.undo();
  ok(kaaAnims.get(roomAnim.id).smooth === undefined, "and Ctrl+Z puts the path back");
  wm._onClose({});

  // A rune circle becomes a seal on the same spot, along a path to reshape
  const {particleToSeal, sealLook} = await imp("seal.js");
  const circleId = (await api.spawn("Holy seal", {x: 2000, y: 2000}))[0];
  const circleDoc = scene.tokens.get(circleId);
  const look = normalizePreset(circleDoc.flags[MOD].particle.preset);
  kfp.history.clear();
  draws.length = 0;
  const made = await particleToSeal(circleDoc);
  const anim = kaaAnims.get(made?.source.animId);
  const R = 100 * look.look.size * 0.93;
  const nodes = anim?.steps[0].shape.nodes ?? [];
  ok(made && !scene.tokens.has(circleId) && sceneWalls(scene).some(w => w.id === made.id), "Make it a seal replaces the particle with a seal");
  ok(anim.steps[0].shape.type === "path" && anim.steps[0].shape.closed && nodes.length === 8 && Math.abs(nodes[0].x - 2000) < 1e-6 && Math.abs(nodes[0].y - (2000 - R)) < 1e-6
    && nodes.every(n => Math.abs(Math.hypot(n.x - 2000, n.y - 2000) - R) < 1e-6), "on a path round its glyph band, ready to reshape");
  const star = made.look.layers.find(l => l.kind === "star");
  ok(made.look.style === "runes" && made.look.palette.join() === look.palette.join() && star?.points === Math.round(look.look.shape) && star.step === 2,
    "in its look: its colours, its glyphs and its star");
  ok(draws.some(d => (d.id === anim.id) && (d.tool === "edit")) && kfp.history.peek()?.label.startsWith("KPE.Undo.Seal"), "the path opens for reshaping; one undo step");
  await kfp.history.undo();
  ok(scene.tokens.has(circleId) && !sceneWalls(scene).some(w => w.id === made.id) && !kaaAnims.has(anim.id), "Ctrl+Z brings the rune circle back");
  // A molded circle keeps its shape as a seal
  const O = await imp("outline.js");
  const sqSeal = await particleToSeal(scene.tokens.get(circleId), {preset: {...look, outline: O.outlineShape("square")}});
  const sqNodes = kaaAnims.get(sqSeal.source.animId).steps[0].shape.nodes;
  ok(sqNodes.length === 4 && Math.abs(sqNodes[0].x - (2000 - (0.9 * R))) < 1e-6 && Math.abs(sqNodes[0].y - (2000 - (0.9 * R))) < 1e-6 && sqNodes.every(n => n.smooth === 0),
    "a molded circle's seal keeps its outline (a square stays a square)");
  ok(sealLook(normalizePreset({kind: "rune", look: {shape: 3}}), 2).layers.find(l => l.kind === "star").step === 1, "a three-sided circle's star is a triangle");
  // The manager offers it for rune circles only
  const {ParticleManager} = await imp("manager.js");
  const orbId = (await api.spawn("Arcane orb", {x: 2600, y: 2000}))[0];
  const runeId = (await api.spawn("Arcane circle", {x: 2900, y: 2000}))[0];
  const man = ParticleManager.open({tokens: [runeId]});
  man.render = function() { return this; };
  ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab: "look"}});
  let mctx = await man._prepareContext({});
  const mtpl = Handlebars.compile(readFileSync(ROOT + "templates/manager.hbs", "utf8"));
  const offered = mctx.look.canSeal && /data-action="makeSeal"/.test(mtpl(mctx));
  man.select([orbId]);
  mctx = await man._prepareContext({});
  ok(offered && !mctx.look.canSeal, "the manager offers Make it a seal for rune circles");
  man._onClose({});
  await api.clearScene();

  // An effect's motion, shaped by hand: the template saved from it becomes the effect's motion
  const {ParticleStudio} = await imp("studio.js");
  const edits = [];
  let extraTemplates = [];
  const realTemplates = kaaApi().templates;
  kaaApi().templates = () => [...realTemplates(), ...extraTemplates];
  kaaApi().editTemplate = async (id, opts) => { edits.push([id, opts]); return {id: "Edited"}; };
  const motionStudio = new ParticleStudio();
  motionStudio.render = function() { return this; };
  motionStudio.element = {addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => []};
  await motionStudio._onFirstRender({}, {});
  ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(motionStudio, {}, {dataset: {tab: "effects"}});
  await ParticleStudio.DEFAULT_OPTIONS.actions.selectItem.call(motionStudio, {}, {closest: () => ({dataset: {id: "builtin-orb-strike"}})});
  let sctx = await motionStudio._prepareContext({});
  ok(sctx.editor.canShapeMotion, "an effect with a motion can have it shaped by hand");
  await ParticleStudio.DEFAULT_OPTIONS.actions.shapeMotion.call(motionStudio);
  ok(edits.at(-1)?.[0] === "builtin-orbit-strike", "its template opens on the map in the animator");
  Hooks.callAll("updateSetting", {key: "some-module.setting"});
  extraTemplates = [{id: "mine-strike", name: "My strike", steps: []}];
  Hooks.callAll("updateSetting", {key: "kostis-actual-animator.library"});
  sctx = await motionStudio._prepareContext({});
  ok(sctx.item.animation === "mine-strike" && sctx.dirty, "saving it as a template makes it the effect's motion (to save with the effect)");
  motionStudio._onClose({});
  kaaApi().templates = realTemplates;
  delete kaaApi().editTemplate;
}

/* ---------------- Windows: out of the way on the map, sized as you left them ---------------- */
{
  const win = await imp("window-ui.js");
  const store = {};
  globalThis.localStorage = {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }};
  const {ParticleStudio} = await imp("studio.js");
  const {ParticleManager} = await imp("manager.js");
  const {WallManager} = await imp("wall-manager.js");
  const {Registry} = await import(pathToFileURL(MODS + "kostis-flying-paths/scripts/registry.js").href);
  const {sceneWalls} = await imp("effect-walls.js");
  for ( const App of [ParticleStudio, ParticleManager, WallManager] ) App.instance?._onClose({});
  // Size and place
  store["kostis-windows"] = JSON.stringify({"kpe-studio": {left: 12, top: 34, width: 640, height: 500}, "kpe-manager": {width: "junk"}});
  const studio = ParticleStudio.open();
  ok(studio.position.width === 640 && studio.position.left === 12 && studio.position.height === 500, "a window opens where and as big as it was left");
  const manager = ParticleManager.open();
  ok(manager.position.width === 900, "(junk is ignored)");
  studio.setPosition({width: 700});
  win.savePosition(studio);
  ok(JSON.parse(store["kostis-windows"])["kpe-studio"].width === 700, "a resized window remembers its new size");
  studio._onClose({});
  ok(JSON.parse(store["kostis-windows"])["kpe-studio"].width === 700, "(also when it closes)");
  // Out of the way while placing on the map: back when the tool is put away, or with Escape
  const st = ParticleStudio.open();
  ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(st, {}, {dataset: {tab: "particles"}});
  ParticleStudio.DEFAULT_OPTIONS.actions.spawnOnMap.call(st);
  await flush();
  ok(st.minimized && win.collapsedFor(st) === "kpePlace", "Place on map tucks the studio away");
  await Registry.tools.get("kpePlace").canvas.deactivate();
  await flush();
  ok(!st.minimized && !win.collapsedFor(st), "picking another tool brings it back");
  ParticleStudio.DEFAULT_OPTIONS.actions.spawnOnMap.call(st);
  await flush();
  const kept = await st.close({closeKey: true});
  await flush();
  ok(kept === st && st.rendered && !st.minimized, "Escape while placing brings the studio back instead of closing it");
  await st.close({closeKey: true});
  ok(!st.rendered, "(Escape closes it as usual otherwise)");
  st._onClose({});
  ParticleManager.DEFAULT_OPTIONS.actions.placeNew.call(manager);
  await flush();
  ok(manager.minimized, "the manager's Place steps aside too");
  await Registry.tools.get("kpePlace").canvas.deactivate();
  await flush();
  ok(!manager.minimized, "(and comes back)");
  manager._onClose({});
  // Drawing a new wall: tucked away until its path has a shape
  const wm = WallManager.open();
  wm.render = function() { return this; };
  wm.rendered = true;
  await WallManager.DEFAULT_OPTIONS.actions.drawNew.call(wm);
  await flush();
  const drawnId = [...kaaAnims.keys()].at(-1);
  ok(wm.minimized && !kaaAnims.get(drawnId).steps.length, "Draw tucks the walls manager away while the path is drawn");
  Hooks.callAll("updateScene", scene, {});
  await flush();
  ok(wm.minimized, "(not yet: the path has no shape)");
  kaaAnims.get(drawnId).steps = [{id: "s0", enabled: true, shape: {type: "ellipse", cx: 0, cy: 0, rx: 100, ry: 100}}];
  Hooks.callAll("updateScene", scene, {});
  await flush();
  ok(!wm.minimized, "and brings it back once the path is drawn");
  await api.walls.remove(sceneWalls(scene).find(w => w.source.animId === drawnId)?.id, {withPath: true});
  wm._onClose({});
  // Never redraw under an open dropdown
  const redraws = [];
  const guard = new win.ChoiceGuard(() => redraws.push(1));
  const on = {};
  guard.watch({addEventListener: (t, fn) => { on[t] = fn; }});
  const dropdown = {tagName: "SELECT", closest: sel => (sel === "select" ? dropdown : null)};
  ok(!guard.hold(), "windows redraw freely");
  on.pointerdown({target: dropdown});
  ok(guard.hold() && guard.hold(), "but wait while a dropdown is open (it would snap shut)");
  on.focusout({target: dropdown});
  ok(redraws.length === 1 && !guard.hold(), "and redraw once it is closed");
  on.pointerdown({target: dropdown});
  on.change({target: dropdown});
  ok(!guard.hold() && (redraws.length === 1), "(choosing closes it: the window redraws for the change itself)");
  delete globalThis.localStorage;
}

/* ---------------- Visual previews (written only when KPE_PREVIEW is set) ---------------- */
if ( process.env.KPE_PREVIEW ) {
  const {writeFileSync} = await import("node:fs");
  const {Preview} = await imp("preview.js");
  const {ParticleStudio} = await imp("studio.js");
  const {sceneWalls} = await imp("effect-walls.js");
  Preview.prototype.thumb = function(preset) { return `thumb:${preset.id}`; };
  const tpl = Handlebars.compile(readFileSync(ROOT + "templates/studio.hbs", "utf8"));
  const studio = new ParticleStudio();
  studio.render = function() { return this; };
  const PUB = pathToFileURL(`${FOUNDRY_APP}/public/`).href;
  const page = (body, current) => `<!doctype html><html><head><meta charset="utf-8"><base href="${PUB}">
<link rel="stylesheet" href="${PUB}css/foundry2.css">
<link rel="stylesheet" href="${PUB}fonts/fontawesome/css/all.min.css">
<link rel="stylesheet" href="file:///${MODS}kostis-flying-paths/styles/hub.css">
<link rel="stylesheet" href="file:///${ROOT}styles/kpe.css">
<style>html,body{margin:0;width:1200px;height:800px;background:#2b2d33 radial-gradient(circle at 30% 20%,#3a3d46,#1c1d22);overflow:hidden}
#kpe-studio{position:absolute;left:20px;top:20px;width:1160px;height:760px;display:flex;flex-direction:column}
#kpe-studio .window-content{flex:1;min-height:0}</style>
<script src="${pathToFileURL(`${FOUNDRY_APP}/node_modules/pixi.js/dist/pixi.min.js`).href}"></script>
<script src="file:///${process.env.KPE_PREVIEW}inline.js"></script></head>
<body class="vtt game theme-dark"><div id="kpe-studio" class="application kfp-app kpe-studio themed theme-dark">
<header class="window-header"><i class="window-icon fa-solid fa-wand-sparkles"></i><h1 class="window-title">Kostis's Particle Effects: Studio</h1>
<button type="button" class="header-control icon fa-solid fa-xmark"></button></header>
<section class="window-content">${body}</section></div>
<script>renderThumbs(${JSON.stringify(current)});</script></body></html>`;
  for ( const tab of ["particles", "emitters", "effects"] ) {
    ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(studio, {}, {dataset: {tab}});
    const ctx = await studio._prepareContext({});
    const cur = tab === "particles" ? ctx.item : (tab === "emitters" ? emitterParticle(ctx.item) : Library.get("particles", ctx.item.particle));
    writeFileSync(process.env.KPE_PREVIEW + `studio-${tab}.html`, page(tpl(ctx), cur));
  }
  // Molding: the holy seal as a square, its points over the preview
  {
    const sl = {};
    studio.element = {addEventListener: (t, fn, capture) => { if ( !capture ) sl[t] = fn; }, querySelector: () => null, querySelectorAll: () => []};
    await studio._onFirstRender({}, {});
    ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(studio, {}, {dataset: {tab: "particles"}});
    await ParticleStudio.DEFAULT_OPTIONS.actions.selectItem.call(studio, {}, {closest: () => ({dataset: {id: "builtin-holy-seal"}})});
    sl.change({target: {name: "moldShape", value: "square", type: "select-one", dataset: {}, closest: () => null}});
    const ctx = await studio._prepareContext({});
    writeFileSync(process.env.KPE_PREVIEW + "studio-mold.html", page(tpl(ctx), ctx.item).replace("<script>renderThumbs(", "<script>window.MOLD = true; renderThumbs("));
  }
  // The manager, with a few particles on the scene
  const {ParticleManager} = await imp("manager.js");
  await api.spawn("Fireball", {x: 1500, y: 300});
  await api.spawn("Frost orb", {x: 1600, y: 300});
  await api.spawn("Ember", [{x: 1700, y: 300}, {x: 1750, y: 320}]);
  await api.spawn("Portal", {x: 1900, y: 500});
  const mtpl = Handlebars.compile(readFileSync(ROOT + "templates/manager.hbs", "utf8"));
  const parts = scene.tokens.filter(t => t.getFlag(MOD, "particle"));
  const man = ParticleManager.open({tokens: [parts[0].id]});
  man.render = function() { return this; };
  for ( const tab of ["look", "token", "attach"] ) {
    ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man, {}, {dataset: {tab}});
    const ctx = await man._prepareContext({});
    for ( const r of ctx.rows ) {
      const pid = scene.tokens.get(r.id)?.getFlag(MOD, "particle")?.preset?.id;
      r.thumb = pid ? `thumb:${pid}` : `${PUB}icons/svg/mystery-man.svg`;
    }
    for ( const a of ctx.attach?.auras ?? [] ) a.thumb = "thumb:builtin-holy-aura";
    const cur = scene.tokens.get(ctx.primary.id).getFlag(MOD, "particle")?.preset;
    const html = page(mtpl(ctx), cur).replace('id="kpe-studio" class="application kfp-app kpe-studio', 'id="kpe-studio" class="application kfp-app kpe-studio kpe-manager')
      .replace("Kostis's Particle Effects: Studio", "Kostis's Particle Effects: Scene particles");
    writeFileSync(process.env.KPE_PREVIEW + `manager-${tab}.html`, html);
  }
  man._onClose({});
  // The manager's Look tab for a rune circle: its outline tools and Make it a seal
  {
    const runeId = (await api.spawn("Holy seal", {x: 2300, y: 600}))[0];
    const man2 = ParticleManager.open({tokens: [runeId]});
    man2.render = function() { return this; };
    ParticleManager.DEFAULT_OPTIONS.actions.switchTab.call(man2, {}, {dataset: {tab: "look"}});
    const ctx = await man2._prepareContext({});
    for ( const r of ctx.rows ) {
      const pid = scene.tokens.get(r.id)?.getFlag(MOD, "particle")?.preset?.id;
      r.thumb = pid ? `thumb:${pid}` : `${PUB}icons/svg/mystery-man.svg`;
    }
    const cur = scene.tokens.get(runeId).getFlag(MOD, "particle")?.preset;
    writeFileSync(process.env.KPE_PREVIEW + "manager-seal.html", page(mtpl(ctx), cur)
      .replace('id="kpe-studio" class="application kfp-app kpe-studio', 'id="kpe-studio" class="application kfp-app kpe-studio kpe-manager')
      .replace("Kostis's Particle Effects: Studio", "Kostis's Particle Effects: Scene particles")
      .replace("<script>renderThumbs(", "<script>window.SCROLL_TO = '.kpe-mold'; renderThumbs("));
    man2._onClose({});
  }
  // Walls: the studio tab and the scene's walls manager
  const wallsOnScene = sceneWalls(scene);
  ParticleStudio.DEFAULT_OPTIONS.actions.switchTab.call(studio, {}, {dataset: {tab: "walls"}});
  const sctx = await studio._prepareContext({});
  for ( const c of sctx.cards ) c.thumb = `wallthumb:${c.id}`;
  writeFileSync(process.env.KPE_PREVIEW + "studio-walls.html", page(tpl(sctx), sctx.item));
  const {WallManager} = await imp("wall-manager.js");
  const wtpl = Handlebars.compile(readFileSync(ROOT + "templates/walls.hbs", "utf8"));
  const wm = WallManager.open({wall: wallsOnScene.find(w => w.look.style === "chains")?.id});
  wm.render = function() { return this; };
  const wctx = await wm._prepareContext({});
  for ( const r of wctx.rows ) r.thumb = `wallthumb:${wallsOnScene.find(w => w.id === r.id)?.preset ?? "builtin-wall-of-fire"}`;
  const cur = wallsOnScene.find(w => w.id === wctx.wall?.id);
  writeFileSync(process.env.KPE_PREVIEW + "walls-manager.html", page(wtpl(wctx), cur)
    .replace('id="kpe-studio" class="application kfp-app kpe-studio', 'id="kpe-studio" class="application kfp-app kpe-studio kpe-manager kpe-walls')
    .replace("Kostis's Particle Effects: Studio", "Kostis's Particle Effects: Effect walls"));
  wm._onClose({});
  // A seal in the walls manager: its layers, scrolled to them
  {
    const sealAnim = await kaaApi().createAnimation({name: "Shrine", steps: [{shape: {type: "ellipse", cx: 4000, cy: 4000, rx: 300, ry: 300, rotation: 0, sweep: 360}}]});
    const sealWall = await api.walls.attach("Holy seal", sealAnim.id);
    const wm2 = WallManager.open({wall: sealWall.id});
    wm2.render = function() { return this; };
    const ctx2 = await wm2._prepareContext({});
    for ( const r of ctx2.rows ) r.thumb = `wallthumb:${sceneWalls(scene).find(w => w.id === r.id)?.preset ?? "builtin-wall-of-fire"}`;
    writeFileSync(process.env.KPE_PREVIEW + "walls-seal.html", page(wtpl(ctx2), sceneWalls(scene).find(w => w.id === sealWall.id))
      .replace('id="kpe-studio" class="application kfp-app kpe-studio', 'id="kpe-studio" class="application kfp-app kpe-studio kpe-manager kpe-walls')
      .replace("Kostis's Particle Effects: Studio", "Kostis's Particle Effects: Effect walls")
      .replace("<script>renderThumbs(", "<script>window.SCROLL_TO = '.kpe-layer'; renderThumbs("));
    wm2._onClose({});
  }
  console.log("previews written");
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
