import type { ZoneDef } from '../zones/types';

/**
 * Every game in the world. Zones without `load` are shown as "coming soon" spots.
 * Coordinates are metres: north is -Z, the beach is to the south (+Z). See terrain.ts for the lie of the land.
 */
export const ZONES: ZoneDef[] = [
  {
    id: 'jandal-flip', title: 'Jandal Flip', kind: 'fun',
    blurb: 'Flick a jandal across the backyard and land it sole-down. New course every day.',
    x: -106, z: -16, facing: 0, start: { x: 0, z: 0.9 },
    load: () => import('../zones/jandal/zone'),
  },
  {
    id: 'trap-line', title: 'Trap Line', kind: 'learn',
    blurb: 'Set traps on the bush block and bring back the dawn chorus by Christmas morning.',
    x: 40, z: -120, facing: 0, start: { x: 0, z: 8.6 },
    load: () => import('../zones/trapline/zone'),
  },
  { id: 'backyard-cricket', title: 'Backyard Cricket', kind: 'fun', blurb: 'Christmas arvo cricket with every house rule.', x: 16, z: -4, facing: 0, start: { x: 0, z: 1 } },
  { id: 'water-bomb', title: 'Water Bomb Boxing Day', kind: 'fun', blurb: 'Lob water bombs over the fence and soak the neighbours.', x: -82, z: -18, facing: 0, start: { x: 0, z: 1 } },
  { id: 'bbq-rush', title: 'Snags & Pav: BBQ Rush', kind: 'fun', blurb: 'Run the Christmas BBQ for a hungry whānau.', x: -96, z: 13, facing: 0, start: { x: 0, z: 1 } },
  { id: 'pack-the-ute', title: 'Pack the Ute', kind: 'fun', blurb: 'Fit the whole Christmas in the ute and survive the gravel road.', x: -118, z: 13, facing: 0, start: { x: 0, z: 1 } },
  { id: 'pav-lab', title: 'Pav Lab', kind: 'learn', blurb: 'Whisk, bake and scale the perfect pavlova.', x: 54, z: -6, facing: 0, start: { x: 0, z: 1 } },
  { id: 'santa-parade', title: 'Float Your Boat', kind: 'fun', blurb: 'Build a Santa Parade float and let the crowd judge it.', x: 44, z: 6, facing: 0, start: { x: 0, z: 1 } },
  { id: 'between-flags', title: 'Between the Flags', kind: 'learn', blurb: 'Read the beach, spot the rips and place the flags.', x: 20, z: 100, facing: 0, start: { x: 0, z: 1 } },
  { id: 'seagull', title: 'Mine! Seagull Christmas', kind: 'fun', blurb: 'Be the gull. Christmas lunch is yours.', x: -18, z: 98, facing: 0, start: { x: 0, z: 1 } },
  { id: 'pohutukawa-garden', title: 'Pōhutukawa Garden', kind: 'learn', blurb: 'Replant the hill so it flowers for the birds.', x: -12, z: -98, facing: 0, start: { x: 0, z: 1 } },
  { id: 'tilt', title: 'Tilt!', kind: 'learn', blurb: 'Why Christmas is a beach day: tilt the Earth and see.', x: 170, z: 74, facing: 0, start: { x: 0, z: 1 } },
  { id: 'korero', title: 'Kōrero Kirihimete', kind: 'learn', blurb: 'Host Christmas lunch in te reo Māori.', x: -106, z: 10, facing: 0, start: { x: 0, z: 1 }, gated: true },
  { id: 'star-waka', title: 'Star Waka', kind: 'learn', blurb: 'Steer by the stars.', x: -45, z: 146, facing: 0, start: { x: 0, z: 1 }, gated: true },
];

export const SPAWN = { x: 30, z: 2, yaw: Math.PI };
