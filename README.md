# Kostis's Particle Effects

[![Latest release](https://img.shields.io/github/v/release/kostis-vtt/kostis-particle-effects?label=release)](https://github.com/kostis-vtt/kostis-particle-effects/releases/latest) ![Foundry v14](https://img.shields.io/badge/Foundry-v14-orange) [![Downloads](https://img.shields.io/github/downloads/kostis-vtt/kostis-particle-effects/total)](https://github.com/kostis-vtt/kostis-particle-effects/releases) [![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/xgpro)

Part of **Kostis's Flying Paths**. Requires the *Kostis's Flying Paths* hub module; works best with *Kostis's Actual Animator*.

Every look is painted by math on the GPU (noise, gradients, light), with no image files to find or license. There are four building blocks:

## Installation

In Foundry, go to *Add-on Modules → Install Module*, paste this manifest URL and press *Install*:

`https://github.com/kostis-vtt/kostis-particle-effects/releases/latest/download/module.json`

Foundry offers to install *Kostis's Flying Paths* along with it (it is required). *[Kostis's Actual Animator](https://github.com/kostis-vtt/kostis-actual-animator)* is recommended: effects fly along its templates and effect walls are drawn with it.

## Particles

Orbs, sparks, motes, flames and wisps, crystals, rune circles, portals, shields and auras: 48 built-in looks, all editable.

- A particle placed on the map is a **real token**: it can be targeted, damaged, moved by the animator, and copied by the animator's kaleidoscope (the copies are real tokens too).
- Its look is **alive**: orbs swirl, flames flicker, runes turn, portals spin. The token stores a still image (baked once into your world folder) and shows the animated version while this module is active.
- Orbs and flames can **light the map** in their own colour.
- Neighbouring particles get different variants, so a crowd never pulses in sync.

### Molding: any shape, by hand

Any particle can be molded into another outline: a square or hexagonal rune circle, a heart-shaped orb, a shield shaped
like a real shield, a portal shaped like a doorway. Its rings, glyphs, glow and star all follow the new outline.

- In the studio or the manager (**Outline**): **Shape by hand** shows the outline's points over the preview. Drag a point
  to move it, drag an edge to pull out a new corner, drag inside to move the whole outline. Double-click a point to make
  it sharp or round, double-click an edge to add a point, right-click a point to remove it.
- **Draw it**: draw the outline in one stroke; it becomes a few points, sharp where your line turned hard.
- **Start from a shape**: square, rectangle, diamond, triangle, hexagon, octagon, star, heart, drop, shield, arch,
  oval, random blob. **Corners** and **Curves** make every point sharp or round, **Mirror** copies the left half onto
  the right, **Circle** goes back to the plain look.
- On the map, the **Mold** tool (hand icon in the Kostis's Flying Paths controls) does the same right where the
  particle stands: click a particle, then drag its points. Every change is one Ctrl+Z step.

## Emitters

Streams of tiny particles: spark trails, rising embers, magic dust, fireflies, frost mist, smoke, bubbles, and one-shot bursts (impacts, explosions). They run on Foundry's own particle engine.

- **Attach** an emitter to tokens and it follows them everywhere, including along animator paths, so an orb flying a homing path leaves a spark trail.
- **Place** fixed emitters on the map (a smoking chimney, fireflies over a pond). Right-click one with the emitter tool to remove it.
- *Inherit* emitters take the colours of the token they are attached to.
- Emitters pause while their token is hidden, so they never give away an invisible creature.

## Effects

One-click casts that spawn particles, fly them with an animator template, trail sparks behind them, burst on impact and clean up after themselves: magic missile, fireball, meteor, orbiting orbs, wisp guard, blade storm, orb strike, spirit hammer, chain lightning, ice volley, radiant nova, open a portal, summoning circle.

Select the caster, target (T) who it hits, then press **Cast**. An effect can last until its animation ends, for a number of seconds, or until removed. Orbit effects circle the caster.

## Effect walls

Animated walls painted along any path: a wall of fire, a sealed room ringed with glowing golden chains, a lightning fence, a wall of ice, a thorn hedge, a rune ward, a force field, a wall of shadow, a river, a laser, a holy seal. Ten styles and 20 ready-made walls, all editable (colours, width, pattern size, speed, intensity, glow, opacity, layers).

- **Any shape**: draw the path with any of the animator's tools (pen, freehand, rectangle, ellipse, polygon, figure eight, spiral, wave), or put a wall on a path you already have, such as the infinity sign of an animation. Edit the path later with the animator and the wall follows.
- **How it appears**: all at once; **growing** from the start to the end of the path (then staying, starting over, or fading away); as a **train** that runs along the path and round loops (keep going, pass once, or stop at the end); or **following a token**, as a trail behind it or "igniting" everything it has passed.
- **Real walls (optional)**: a wall can also block movement, sight, or both. Foundry walls are made along it while it fully stands (all at once, or once it has finished growing and stays) and removed when it goes. They are kept out of Ctrl+Z and managed by the GM's client.
- **Emitters (optional)**: embers rising off a wall of fire, sparks off a lightning fence. Particles only come off the part that is showing.
- **Under or over tokens**, and hidden from players while you prepare it (you still see it, faded).
- **Levels**: on a scene with several levels, a wall belongs to the level you were viewing when you made it (it shows, and blocks, there).
- A trail that follows a token GM-hidden from players leaves nothing for them to see.
- Every client draws the walls itself and they stay in step (they all use the server's clock).

Make them in the **Walls** tab of the studio (pick a style, press *Draw on map*) or in the **Effect walls** manager (road-barrier icon in the Kostis's Flying Paths controls), which lists the scene's walls and edits them live: changes show on the map for you until you **Apply** them for everyone. Walls need *Kostis's Actual Animator* (it draws and keeps the paths).

- **Reshape** a wall's path by hand with the animator's edit tool (the curve button in the manager): drag its points,
  double-click the path to add a point or a point to make it a corner, right-click a point to remove it. **Corners**
  and **Curves** (next to it) make every point of the path sharp, for the walls of a room, or round.

### Layers and seals

A wall can have **layers**, up to four, that follow its path wherever it goes: **a line beside it** (a ring inside or
outside a loop, at any distance) and **a star across it** (points spread round the middle of a loop, joined every
few: a pentagram, a hexagram, a heptagram…, drawn in towards the middle and turned as you like). Each layer has its own
style, width, speed, glow and opacity, and the wall's colours or its own. A star lights up once its loop is complete.

**Seals** are walls like that: Holy seal, Arcane seal, Infernal seal and Druid circle come built in. Draw one round a
room with the rectangle or polygon tool and you have a sealed room (set **Blocks** to *Movement* to really seal it).

**Make it a seal**: in the manager's Look tab, a rune circle can turn into a seal on the same spot, in its own colours
with its own star, along a path that keeps its outline (molded or round). The path opens for reshaping at once: drag
its points over the walls of a room. Ctrl+Z brings the rune circle back.

## The studio

Open it from the *Kostis's Flying Paths* scene controls (wand icon), the hub launcher, or a keybinding. Like the
manager and the effect walls manager, it can be resized down to a small window (drag its bottom-right corner; it
rearranges as it narrows) and opens where and as big as you left it. When you place something on the map from it,
it tucks itself away to its title bar and comes back when you are done (press Escape or pick another tool). Browse by category, pick anything, change it with the sliders and colour pickers while the preview updates live (and, for particles, mold its outline by hand).

- **Save** keeps your changes. On a built-in look it changes the built-in itself, for this world, so everything that
  uses it (effects, new walls) uses your version; it is marked with a pen, and **Reset** brings back the original.
- **Save as mine** makes a copy of your own instead.
- An effect's motion can be **shaped by hand**: the curve button next to its Animation opens that animator template on
  the map (at the selected token). Reshape it with the animator's tools and keep it with *Save as template* in the
  animator panel: the effect then moves along it (save the effect to keep that).

## Scene particles (the manager)

Every particle on the scene, plus every token wearing an aura or an emitter, in one list. Open it with the list icon in the Kostis's Flying Paths controls, the **Scene particles** button in the studio, the wand button on a particle's Token HUD, or simply by **double-clicking a particle**.

- **Find and select**: search, filter (particles, with auras or emitters, animated, from casts), click a row (Ctrl/Shift-click to add more). Selecting in the list selects on the map and vice versa.
- **Look**: every slider and colour of the studio, shown live on the map for you while you edit. **Apply** makes it permanent for everyone; **Revert** forgets it. Start from any look in your library, or save the edited look to it.
- **Token**: name, size (up to 100 squares; big particles get sharper textures), opacity, elevation, rotation, upright, disposition, hidden, and its light (radius, strength, colour, animation).
- **Controlled by** (GM): only the GM, chosen players, or everyone. Owners can move, change and remove a particle and play its animations, like any token they own.
- **Auras & emitters**: add, remove and adjust (size, spin, under/over the token).
- **Motion**: see the animator animation it is running, pause, stop, return, change its rate, play any template (attacks included) or any of the scene's animations, or open it in the animator.
- **Lifetime** (particles only): make it disappear after some seconds, or keep it forever.
- **Duplicate** (GM), **hide, show, delete**. With several selected, every change applies to all of them. Deleting removes particles; other tokens only lose their auras and emitters.

## Undo

Everything this module does can be undone with **Ctrl+Z** (or the Undo buttons in the studio and the managers): placing, removing and duplicating particles, casts, auras, emitters, fixed emitters, clearing the scene, every change made in the manager, and making, changing and removing effect walls (with their paths). On the token layer, Ctrl+Z undoes whichever came last: an ordinary token edit or a particle step.

## Map tools (Kostis's Flying Paths controls)

| Tool | Does |
|---|---|
| Particle studio | Opens the studio. |
| Scene particles | Opens the manager. |
| Effect walls | Opens the effect walls manager (GM). |
| Place particles | Click to place the selected particle as a token (Shift snaps to the grid). |
| Mold | Click a particle, then drag its outline's points (see *Molding*). |
| Place emitters | Click to place the selected emitter; right-click one to remove it. |
| Cast | Click to cast the selected effect (point effects appear where you click). The caster is the token you selected before switching to these controls. |
| Clear | Removes every particle, aura and emitter from the scene. |

## Who controls particles

A token without an actor belongs to everyone in Foundry. So that each particle can have owners like any other token, particles are linked (as unlinked tokens) to one shared, empty actor named **Particles**, in an actor folder *Kostis's Particle Effects*. Don't use or delete it; if it is deleted, a new one takes over and every particle keeps its owners.

- Particles the GM places are the GM's. Particles a player places are that player's.
- Effects give their particles to **whoever controls the caster** (a boss a player runs casts orbs that player controls), or to the GM only, or to everyone: *Controlled by* in the effect's settings.
- Change it any time in the manager's Token tab. Particles made with earlier versions (no actor) count as everyone's until you change them.

## Players

With *Players can cast effects* on (the default), players can open the studio, place particles and cast from their own tokens. The GM's client does it for them (a GM must be connected), on the scene they are viewing, and only within sensible limits. Players can remove (and undo removing) the particles they made or control, and only see those in the manager.

## Macro API

```js
KPE.cast("Fireball");                                   // from the selected token at your targets
KPE.spawn("Arcane orb", {x: 1200, y: 800});             // a particle token
KPE.attachAura(canvas.tokens.controlled, "Holy aura");
KPE.addEmitter(canvas.tokens.controlled, "Rising embers");
KPE.burst("Explosion", {x: 1200, y: 800});
KPE.despawn();                                          // every particle on the scene
KPE.openStudio({tab: "effects"});

// Effect walls
await KPE.walls.draw("Wall of fire", {tool: "freehand"});          // draw a new path on the map
await KPE.walls.attach("Sealing chains", KAA.getAnimation("Room").id);   // along an existing path
await KPE.walls.update(id, {reveal: {mode: "grow", duration: 6, then: "stay"}, blocks: "move"});
await KPE.walls.restart(id);                                       // grow / train again from the start
await KPE.walls.remove(id, {withPath: true});
KPE.walls.list();
KPE.openWalls();
```

Hook: `kostis-particle-effects.cast` fires after a cast with `{effect, cast, tokens, caster, targets}`.

## Settings

*Animate particles*, *frame rate*, *texture quality* and *Show particle emitters* are per-client, so slower machines can scale down without affecting anyone else.

## Support

Found a bug or have an idea? Open an issue on [GitHub](https://github.com/kostis-vtt/kostis-particle-effects/issues).

These modules are free. If you enjoy them, you can support their development on [Ko-fi](https://ko-fi.com/xgpro).

## Licence

MIT: see [LICENSE](LICENSE).

## Development

The tests run with plain Node, with Foundry mocked: run each file in `tests/` with `node` (for example
`node tests/kpe.test.mjs`). Some load Handlebars and PIXI from a local Foundry install: set `FOUNDRY_APP` to its `resources/app`
folder if Foundry isn't installed in `C:/Program Files/Foundry Virtual Tabletop`. The family's other modules are
expected in folders next to this one.

To release a version: set it in `module.json`, add a `## <version>` section to `CHANGELOG.md`, commit, and push a tag
`v<version>`. GitHub Actions builds `module.zip` and publishes the release. The manifest URL of the latest version is
`https://github.com/kostis-vtt/kostis-particle-effects/releases/latest/download/module.json`.
