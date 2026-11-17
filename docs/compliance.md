# Advertising compliance checklist

Mentos is an "occasional" food under the NZ ASA Children and Young People's Advertising Code, so
this game must not target children (under 14). The rules below are built into the game. This is a
working reading of the code, not legal advice: the client's compliance team signs off before launch.

## Built into the game
- **Audience:** written for teens 14+, adults and families playing together. All six playable
  characters are adults. No "for kids" positioning in any copy.
- **No consumption mechanics:** the product never appears as a collectible, power-up, currency,
  reward or food. Nothing urges anyone to buy, eat or ask for it.
- **No pester power or purchase links:** no on-pack codes, prizes or unlocks tied to buying.
- **No gambling-like mechanics:** no loot boxes or randomised rewards.
- **Brand presence only as "Presented by":** loading screen, character select, the world title
  pill, end cards, and two billboards in the world (`buildBillboard` in `src/world/map.ts`).
  Nothing inside gameplay. All brand text comes from `src/shared/brand.ts`.
- **Privacy:** no accounts, no personal data, no analytics. Local storage holds only the chosen
  character and best scores. Share text contains no personal data.

## Client side, before launch
- [ ] Compliance sign-off on the game and all campaign copy.
- [ ] Media plan: no placement where under-14s are 25% or more of the expected audience.
- [ ] Official logo and colours supplied (the lockup is text-only until then).

## Content reviews still needed
- [ ] Between the Flags rip and safety content (3Rs): Surf Life Saving NZ or Water Safety NZ.
- [ ] Pōhutukawa Garden flowering months: DOC or a native plant nursery.
- [ ] Kōrero Kirihimete phrases (and recorded audio): a fluent te reo Māori speaker. Hidden behind `?preview` until then.
- [ ] Star Waka: a wayfinding partner (for example a waka hourua trust) decides what is shared and how. Hidden behind `?preview` until then.
- [ ] Trap Line predator behaviour: DOC or a community trapping group.
- [ ] Te reo Māori names and macrons: a paid Māori reviewer.
