# NZ Games

Mobile-first three.js games for a Kiwi Christmas campaign.

| Game | Path | Status |
|---|---|---|
| Jandal Flip | `/jandal-flip/` | Playable prototype |
| Trap Line | `/trap-line/` | Not started |

## Run

```bash
npm install
npm run dev      # http://localhost:5173/jandal-flip/
npm run build    # static site in dist/
```

`?seed=anything` on the Jandal Flip URL loads a fixed course instead of today's (NZ date).

## Layout

- `src/shared/` – asset loading, seeded RNG / NZ daily date, brand config (`brand.ts`).
- `src/jandal/` – Jandal Flip: `course.ts` (daily course), `main.ts` (game loop, physics, input), `ui.ts` (HUD and share card).
- `assets-src/kaykit/` – GLTF sources from the KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com).
- `scripts/models.json` – the models the games actually ship. `npm run assets` copies only those into `public/models/` (git-ignored, regenerated on dev/build).

To use another KayKit model, add it to `scripts/models.json` and load it with `spawnProp('<pack>/<name>', { width | height })`, which re-centres it and scales it to metres (the packs use different unit scales).

## Brand

All campaign-specific text and colours live in `src/shared/brand.ts`. The palette is a placeholder: official logo files and colours need to come from the client's brand kit.
