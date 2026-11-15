# Kiwi Christmas Games

A mobile-first three.js open world: pick a character, walk around a Kiwi summer town, and step
into a game's ring to play it in place.

| Game | Where | Status |
|---|---|---|
| Jandal Flip | Bach backyard | Playable |
| Trap Line | Bush block | Playable |
| 10 more (cricket, water bombs, BBQ, ute, pav lab, parade, flags, seagull, garden, tilt) | Marked in the world | Coming soon |
| Kōrero Kirihimete, Star Waka | Hidden unless `?preview` | Not built; need a Māori reviewer first |

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
- `src/world/` – the town (`map.ts`), zone list (`zones.ts`), zone loading and prompts (`zoneManager.ts`), shared game HUD (`zoneUi.ts`), all CSS (`world.css`).
- `src/zones/<game>/zone.ts` – one game each, implementing `GameZone` from `src/zones/types.ts`. Each is lazy-loaded when the player walks near it.
- `assets-src/kaykit/` – GLTF sources from the KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com).
- `scripts/models.json` – the props that ship. `npm run assets` copies them to `public/models/` and trims the character animation files (both git-ignored, regenerated on dev/build).
- `.claude/skills/` – third-party UI skills (impeccable, ui-ux-pro-max, design-taste-frontend) used when working on the interface.

## Adding a game

1. Create `src/zones/<id>/zone.ts` exporting `createZone(ctx)`. Build everything under `ctx.root` (local space), use `ctx.ui` for the HUD and end card, and `ctx.rig.shot()` for the camera.
2. Add `load: () => import('../zones/<id>/zone')` to its entry in `src/world/zones.ts`.

## Brand and compliance

Brand text and colours live in `src/shared/brand.ts`. The rules the game follows as advertising
for an occasional food are in `docs/compliance.md`.
