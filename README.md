# Kiwi Christmas Games

A mobile-first three.js open world: pick a character and wander Pōhutukawa Bay, a Kiwi summer
town of about 420 × 360 m with a township, bach road, beach, wharf, campground, farm, bush
reserve and lighthouse headland. Step into a game's ring to play it in place, spot native
birds, collect postcards and do small jobs for the locals.

| Game | Where | Kind |
|---|---|---|
| Jandal Flip | Bach Road backyard | Fun · daily course |
| Backyard Cricket | Paddock behind the green | Fun · daily bowling |
| Water Bomb Boxing Day | Neighbour's yard, Bach Road | Fun · turn-based vs the neighbour |
| Pack the Ute | Bach driveway | Fun · daily packing puzzle |
| Mine! Seagull Christmas | The beach | Fun · play as the gull |
| Snags & Pav: BBQ Rush | Our bach's deck | Fun · 90 s cooking rush |
| Float Your Boat | East side of the green, then main street | Fun · daily parade theme |
| Trap Line | Bush reserve clearing | Learn · predator control |
| Between the Flags | Patrol tower on the beach | Learn · spotting rips |
| Tilt! | Lighthouse lookout | Learn · why seasons happen |
| Pav Lab | Bake-off tent on the green | Learn · food chemistry and ratios |
| Pōhutukawa Garden | Bush clearing (west) | Learn · year-round nectar |
| Kōrero Kirihimete | Yellow bach (`?preview` only) | Learn · te reo at the table. Gated until reviewed |
| Star Waka | End of the wharf (`?preview` only) | Learn · wayfinding. Gated until partnered |

## Run

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # static site in dist/
```

Needs Node 22. URL options: `?seed=anything` fixes the daily course/block, `?reveal` shows every
predator at night in Trap Line, `?preview` shows gated zones, `?quality=low|high` overrides the
graphics preset, `?renderer=webgl` forces the WebGL 2 backend, `?time=0..1` jumps the day/night
cycle (0 day, 0.42 dusk, 0.6 night, 0.8 dawn) and freezes it.

## Rendering and controls

- three.js `WebGPURenderer`: WebGPU where the browser has it, WebGL 2 otherwise (most iPhones
  today). Every custom shader is a TSL node material, so both backends draw the same thing.
  The map sheet shows which one is running.
- A world data texture (`src/world/dataTexture.ts`: paths, grass density, water depth, sand)
  drives the terrain colour, the GPU grass around the player and the shore ripples.
- Day, dusk, night and dawn presets (`src/world/sky.ts`), with fog measured from the player.
- Quality: phones default to Smooth (low), desktops to Detailed (high); the map sheet toggles it.
- Touch: drag from your character to walk (past the ground ring to run), tap them to jump,
  two fingers to zoom and turn. Keyboard: WASD, drag or Q/R to look, wheel to zoom, Space, E.
  Gamepads: standard, Xbox and PlayStation layouts. Prompts follow the device you used last.
- Performance: static props are baked per material per 48 m cell (`src/world/batch.ts`),
  repeated props are instanced per 80 m cell, characters are culled out of view.

## Layout

- `src/engine/` – renderer and loop (`app.ts`), quality presets (`quality.ts`), shared TSL uniforms and fog (`tsl.ts`), touch, keyboard and gamepad input (`input.ts`), camera rig, 2D walking colliders.
- `src/character/` – the six KayKit Adventurers re-dressed as Kiwi holidaymakers (`character.ts`) and the walking controller.
- `src/world/` – the lie of the land (`terrain.ts`, one `groundHeight()` everything stands on), the districts (`map.ts`), placement helper with a grounding audit (`build.ts`), procedural props (`props.ts`), townsfolk, traffic and animals (`life.ts`), birds, postcards and jobs (`collect.ts`), synthesised sound (`audio.ts`), zone list and loading (`zones.ts`, `zoneManager.ts`), shared game HUD (`zoneUi.ts`), all CSS (`world.css`).
- `src/zones/<game>/zone.ts` – one game each, implementing `GameZone` from `src/zones/types.ts`. Each is lazy-loaded when the player walks near it.
- `assets-src/kaykit/` – GLTF sources from the KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com).
- `scripts/models.json` – the props that ship. `npm run assets` copies them to `public/models/` and trims the character animation files (both git-ignored, regenerated on dev/build).
- `.claude/skills/` – third-party skills used when working on the project: UI (impeccable, ui-ux-pro-max, design-taste-frontend) and game development (from awesome-gamedev-agent-skills and Claude Code Game Studios; licences alongside).

## Placing things in the world

Use the `Builder` in `src/world/build.ts`: `b.put(model, x, z, opts)` for one prop, `b.many()` for
instanced copies, `b.add()` for procedural objects and `b.seat()` for somewhere a character can sit.
All of them drop onto `groundHeight(x, z)`. In dev, `window.__world.audit()` lists any prop that
floats or sinks.

## Adding a game

1. Create `src/zones/<id>/zone.ts` exporting `createZone(ctx)`. Build everything under `ctx.root` (local space), use `ctx.ui` for the HUD and end card, and `ctx.rig.shot()` for the camera.
2. Add `load: () => import('../zones/<id>/zone')` to its entry in `src/world/zones.ts`.

## Brand and compliance

Brand text and colours live in `src/shared/brand.ts`. The rules the game follows as advertising
for an occasional food are in `docs/compliance.md`.
