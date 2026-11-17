import type { ZoneDef } from '../zones/types';

/**
 * Every game in the world. Coordinates are metres: north is -Z, the beach is to the south (+Z).
 * See terrain.ts for the lie of the land. `facing` turns the zone so its local -Z points that way.
 */
export const ZONES: ZoneDef[] = [
  {
    id: 'jandal-flip', title: 'Jandal Flip', kind: 'fun',
    blurb: 'Flick a jandal across the backyard and land it sole-down. New course every day.',
    x: -106, z: -16, facing: 0, start: { x: 0, z: 0.9 }, pad: 15, clear: 15,
    load: () => import('../zones/jandal/zone'),
  },
  {
    id: 'trap-line', title: 'Trap Line', kind: 'learn',
    blurb: 'Set traps on the bush block and bring back the dawn chorus by Christmas morning.',
    x: 40, z: -120, facing: 0, start: { x: 0, z: 8.6 }, pad: 14, clear: 15,
    load: () => import('../zones/trapline/zone'),
  },
  {
    id: 'backyard-cricket', title: 'Backyard Cricket', kind: 'fun',
    blurb: 'Christmas arvo cricket with every house rule. Two overs, three wickets.',
    x: -6, z: -48, facing: 0, start: { x: 2.4, z: 2.6 }, pad: 22, clear: 26,
    load: () => import('../zones/cricket/zone'),
  },
  {
    id: 'water-bomb', title: 'Water Bomb Boxing Day', kind: 'fun',
    blurb: 'Lob water bombs over the hedge and soak the neighbours before they soak you.',
    x: -82, z: -16, facing: 0, start: { x: 0, z: 3 }, pad: 0, clear: 8,
    load: () => import('../zones/waterbomb/zone'),
  },
  {
    id: 'bbq-rush', title: 'Snags & Pav: BBQ Rush', kind: 'fun',
    blurb: 'Run the Christmas BBQ for a hungry whānau before anything burns.',
    x: -106, z: 8, facing: 0, start: { x: 3.6, z: 4.6 }, pad: 0, clear: 6,
    load: () => import('../zones/bbq/zone'),
  },
  {
    id: 'pack-the-ute', title: 'Pack the Ute', kind: 'fun',
    blurb: 'Fit the whole Christmas in the ute, then survive the gravel road to the bach.',
    x: -122, z: 13, facing: Math.PI / 2, start: { x: 0, z: 4.2 }, pad: 0, clear: 7,
    load: () => import('../zones/ute/zone'),
  },
  {
    id: 'seagull', title: 'Mine! Seagull Christmas', kind: 'fun',
    blurb: 'Be the gull. Christmas lunch is on the sand and nobody is watching. Probably.',
    x: -24, z: 94, facing: Math.PI, start: { x: 0, z: 10.5 }, pad: 0, clear: 14,
    load: () => import('../zones/seagull/zone'),
  },
  {
    id: 'between-flags', title: 'Between the Flags', kind: 'learn',
    blurb: 'Read the beach, spot the rips and place the flags where it is safe to swim.',
    x: 20, z: 99, facing: Math.PI, start: { x: 0, z: -3 }, pad: 0, clear: 10,
    load: () => import('../zones/flags/zone'),
  },
  {
    id: 'tilt', title: 'Tilt!', kind: 'learn',
    blurb: 'Why is Christmas a beach day here? Tilt the Earth and find out.',
    x: 165, z: 64, facing: -Math.PI / 2, start: { x: 0, z: 3.2 }, pad: 6, clear: 8,
    load: () => import('../zones/tilt/zone'),
  },
  {
    id: 'pav-lab', title: 'Pav Lab', kind: 'learn',
    blurb: 'Whisk, sweeten and bake the perfect pavlova. The chemistry decides.',
    x: 54, z: -14, facing: -Math.PI / 2, start: { x: 0, z: 3 }, pad: 6, clear: 7,
    load: () => import('../zones/pavlab/zone'),
  },
  {
    id: 'pohutukawa-garden', title: 'Pōhutukawa Garden', kind: 'learn',
    blurb: 'Replant the hillside so there is nectar for the birds all year round.',
    x: -12, z: -96, facing: 0, start: { x: 0, z: 7 }, pad: 11, clear: 14,
    load: () => import('../zones/garden/zone'),
  },
  {
    id: 'santa-parade', title: 'Float Your Boat', kind: 'fun',
    blurb: 'Build a Santa Parade float, then roll it down main street for the crowd.',
    x: 46, z: -2, facing: 0, start: { x: 0, z: 4.4 }, pad: 6, clear: 6,
    load: () => import('../zones/parade/zone'),
  },
  {
    id: 'korero', title: 'Kōrero Kirihimete', kind: 'learn',
    blurb: 'Help set the Christmas table by listening to what the whānau ask for in te reo Māori.',
    x: -134, z: 12, facing: 0, start: { x: 0, z: 3 }, pad: 0, clear: 6, gated: true,
    load: () => import('../zones/korero/zone'),
  },
  {
    id: 'star-waka', title: 'Star Waka', kind: 'learn',
    blurb: 'Hold your course through the night by the rising and setting stars.',
    x: -45, z: 146, facing: Math.PI, start: { x: 0, z: -3 }, pad: 0, clear: 0, gated: true,
    load: () => import('../zones/starwaka/zone'),
  },
];

export const SPAWN = { x: 30, z: 2, yaw: Math.PI };
