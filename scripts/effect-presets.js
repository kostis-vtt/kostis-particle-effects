// Effects: one-click casts that spawn particle tokens, fly them with an animator template, trail sparks behind
// them, burst on impact and clean up after themselves.

import {EFFECT_OWNERS} from "./ownership.js";

export const SPAWN_AT = {caster: "At the caster", target: "At each target", point: "Where I click"};
export const ANCHORS = {target: "Circle the first target", caster: "Circle the caster"};
export const LIFETIMES = {animation: "Until its animation ends", timed: "For a number of seconds", forever: "Until removed"};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const idOrNull = v => (typeof v === "string" && v ? v : null);

/** Fill in and clamp an effect. */
export function normalizeEffect(e={}) {
  return {
    id: idOrNull(e.id),
    name: String(e.name ?? "Effect"),
    description: String(e.description ?? ""),
    category: typeof e.category === "string" ? e.category : "mine",
    builtin: !!e.builtin,
    particle: idOrNull(e.particle) ?? "builtin-arcane-orb",
    size: e.size == null || e.size === "" ? null : clamp(num(e.size, 0.5), 0.1, 100),
    count: Math.round(clamp(num(e.count, 1), 1, 12)),
    spawnAt: e.spawnAt in SPAWN_AT ? e.spawnAt : "caster",
    animation: idOrNull(e.animation),
    anchor: e.anchor in ANCHORS ? e.anchor : "target",
    rate: clamp(num(e.rate, 1), 0.1, 5),
    trail: idOrNull(e.trail),
    impact: idOrNull(e.impact),
    casterAura: idOrNull(e.casterAura),
    lifetime: e.lifetime in LIFETIMES ? e.lifetime : "animation",
    owners: e.owners in EFFECT_OWNERS ? e.owners : "caster",
    seconds: clamp(num(e.seconds, 10), 1, 3600)
  };
}

const fx = (id, name, description, data) => normalizeEffect({id: `builtin-${id}`, builtin: true, category: "effects", name, description, ...data});

export const BUILTIN_EFFECTS = [
  fx("magic-missile", "Magic missile", "Three darts of force streak to your targets and pop.", {
    particle: "builtin-arcane-mote", size: 0.4, animation: "builtin-missiles", trail: "builtin-spark-trail", impact: "builtin-impact"
  }),
  fx("fireball", "Fireball", "A lobbed ball of fire that explodes on your target.", {
    particle: "builtin-fireball", size: 0.7, animation: "builtin-fireball", trail: "builtin-embers", impact: "builtin-explosion"
  }),
  fx("meteor", "Meteor", "A blazing star crashes down on the target.", {
    particle: "builtin-sun-orb", size: 1, animation: "builtin-meteor", trail: "builtin-spark-trail", impact: "builtin-explosion"
  }),
  fx("orbiting-orbs", "Orbiting orbs", "Three arcane orbs circle the caster until dismissed.", {
    particle: "builtin-arcane-orb", size: 0.45, animation: "builtin-orbs", anchor: "caster", trail: "builtin-magic-dust", lifetime: "forever"
  }),
  fx("wisp-guard", "Wisp guard", "Four will-o'-wisps orbit the caster for a minute.", {
    particle: "builtin-wisp", size: 0.5, animation: "builtin-shield-orbit", anchor: "caster", lifetime: "timed", seconds: 60
  }),
  fx("blade-storm", "Blade storm", "Six obsidian blades whirl around the caster.", {
    particle: "builtin-obsidian", size: 0.45, animation: "builtin-blade-storm", anchor: "caster", trail: "builtin-spark-trail", lifetime: "timed", seconds: 30
  }),
  fx("orb-strike", "Orb strike", "Four orbs circle the caster, then dive at your targets.", {
    particle: "builtin-void-orb", size: 0.4, animation: "builtin-orbit-strike", anchor: "caster", trail: "builtin-spark-trail", impact: "builtin-impact"
  }),
  fx("spirit-hammer", "Spirit hammer", "A radiant hammer flies at the target and returns.", {
    particle: "builtin-holy-orb", size: 0.5, animation: "builtin-hammer", trail: "builtin-holy-motes", impact: "builtin-impact"
  }),
  fx("chain-lightning", "Chain lightning", "A crackling orb ricochets between your targets.", {
    particle: "builtin-storm-orb", size: 0.4, animation: "builtin-ricochet", trail: "builtin-spark-trail", impact: "builtin-impact"
  }),
  fx("ice-volley", "Ice volley", "Five ice shards arc onto your targets.", {
    particle: "builtin-ice-shard", size: 0.35, animation: "builtin-volley", trail: "builtin-spark-trail", impact: "builtin-frost-burst"
  }),
  fx("radiant-nova", "Radiant nova", "Twelve motes of light burst outward from the caster.", {
    particle: "builtin-holy-mote", size: 0.35, animation: "builtin-shockwave", trail: "builtin-spark-trail"
  }),
  fx("portal", "Open a portal", "A swirling portal opens where you click.", {
    particle: "builtin-portal", size: 2, spawnAt: "point", animation: null, trail: "builtin-magic-dust", lifetime: "forever"
  }),
  fx("summoning-circle", "Summoning circle", "An arcane circle glows under the caster for a minute.", {
    particle: "builtin-arcane-circle", size: 2, spawnAt: "caster", animation: null, lifetime: "timed", seconds: 60
  })
];
