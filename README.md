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
predator at night in Trap Line, `?preview` shows gated zones.

## Layout

- `src/engine/` – renderer and loop (`app.ts`), thumb-stick and keyboard (`input.ts`), camera rig, 2D walking colliders.
- `src/character/` – the six KayKit Adventurers re-dressed as Kiwi holidaymakers (`character.ts`) and the walking controller.
- `src/world/` – the lie of the land (`terrain.ts`, one `groundHeight()` everything stands on), the districts (`map.ts`), placement helper with a grounding audit (`build.ts`), procedural props (`props.ts`), townsfolk, traffic and animals (`life.ts`), birds, postcards and jobs (`collect.ts`), synthesised sound (`audio.ts`), zone list and loading (`zones.ts`, `zoneManager.ts`), shared game HUD (`zoneUi.ts`), all CSS (`world.css`).
- `src/zones/<game>/zone.ts` – one game each, implementing `GameZone` from `src/zones/types.ts`. Each is lazy-loaded when the player walks near it.
- `assets-src/kaykit/` – GLTF sources from the KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com).
- `scripts/models.json` – the props that ship. `npm run assets` copies them to `public/models/` and trims the character animation files (both git-ignored, regenerated on dev/build).
- `.claude/skills/` – third-party UI skills (impeccable, ui-ux-pro-max, design-taste-frontend) used when working on the interface.

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
