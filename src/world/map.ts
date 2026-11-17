import * as THREE from 'three';
import type { Placement } from '../shared/assets';
import { brand } from '../shared/brand';
import { hashString, mulberry32 } from '../shared/rng';
import { Colliders } from '../engine/colliders';
import { Builder, box, cyl, paint, type Place, type Seat } from './build';
import * as P from './props';
import {
  addPad, addPlatform, biomeAt, fbm, groundHeight, HEADLAND, inStream, landHeight, SEA_LEVEL, STREAM_Z0, STREAM_Z1, streamHalf, streamSurface, streamX, waterline, WORLD,
} from './terrain';
import { ZONES } from './zones';
import { buildWorldData, type WorldData } from './dataTexture';
import { buildFlowers, buildGrass, glowBulb, terrainMaterial } from './ground';
import { buildSea, buildStream, Buoyancy } from './water';
import { quality } from '../engine/quality';
import { world } from '../engine/tsl';

/** Things that float (filled while building; the buoyancy system picks them up). */
const floaters: THREE.Object3D[] = [];

/**
 * The town of Pōhutukawa Bay, district by district. Layout (north is -Z):
 *
 *   north-west  farm          north        bush reserve, stream, waterfall
 *   west        bach road     centre       township, green           east  estuary, headland
 *   south-west  campground    south        park, surf club, beach, wharf, the bay
 */
export interface WorldMap {
  colliders: Colliders;
  seats: Seat[];
  places: Place[];
  /** Polylines NPCs stroll along. */
  walks: THREE.Vector2[][];
  /** Lanes for traffic along the main street. */
  lanes: { from: THREE.Vector3; to: THREE.Vector3 }[];
  audit(): string[];
  update(dt: number, elapsed: number): void;
}

export const STREET_Z = 20;
export const STREET_X0 = -60;
export const STREET_X1 = 116;
/** KayKit road tile at 8 m: asphalt surface and footpath heights above the tile base. */
const ASPHALT = 0.28;
const KERB = 0.4;
const ROAD_SINK = 0.25;
const KERB_TOP = KERB - ROAD_SINK;

const rng = mulberry32(hashString('pohutukawa-bay'));
const rand = (a: number, b: number) => a + rng() * (b - a);
const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)];

// -- Tracks painted onto the ground (and used to keep scenery off them) ----------
interface Track {
  points: [number, number][];
  width: number;
  kind: 'gravel' | 'dirt';
}
const TRACKS: Track[] = [
  { kind: 'gravel', width: 3.4, points: [[STREET_X0, 20], [-200, 20]] },
  { kind: 'gravel', width: 2.6, points: [[STREET_X1, 20], [131, 20]] },
  { kind: 'dirt', width: 1.7, points: [[150, 20], [160, 34], [168, 52], [174, 66], [178, 74]] },
  { kind: 'dirt', width: 1.6, points: [[30, -28], [33, -60], [36, -88], [40, -106]] },
  { kind: 'dirt', width: 1.5, points: [[50, -122], [80, -112], [106, -102], [120, -100]] },
  { kind: 'dirt', width: 1.5, points: [[135, -100], [141, -122], [146, -140]] },
  { kind: 'dirt', width: 1.5, points: [[36, -88], [10, -96], [-10, -96]] },
  { kind: 'gravel', width: 1.8, points: [[-10, 36], [-10, 60], [-6, 86]] },
  { kind: 'gravel', width: 1.8, points: [[60, 36], [60, 62], [56, 88]] },
  { kind: 'gravel', width: 2.2, points: [[-45, 24], [-45, 102]] },
  { kind: 'gravel', width: 2.6, points: [[-130, 20], [-130, -60], [-128, -112]] },
  { kind: 'gravel', width: 2.4, points: [[-92, 24], [-92, 60], [-162, 60], [-162, 24]] },
  { kind: 'gravel', width: 1.8, points: [[-10, 60], [60, 62]] },
];

export function trackDistance(x: number, z: number): { d: number; track: Track | null } {
  let best = Infinity;
  let which: Track | null = null;
  for (const t of TRACKS) {
    for (let i = 0; i < t.points.length - 1; i++) {
      const [ax, az] = t.points[i];
      const [bx, bz] = t.points[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const k = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = Math.hypot(x - (ax + dx * k), z - (az + dz * k)) - t.width;
      if (d < best) {
        best = d;
        which = t;
      }
    }
  }
  return { d: best, track: which };
}

/** Rectangles kept clear of random scenery: [minX, maxX, minZ, maxZ]. */
const CLEAR: [number, number, number, number][] = [
  [STREET_X0 - 6, STREET_X1 + 6, STREET_Z - 16, STREET_Z + 16], // street and shops
  [6, 54, -34, 10], // the green
  [-170, -66, -40, 16], // bach sections
  [-178, -74, 36, 84], // campground
  [-22, 50, 44, 92], // park, playground, surf club
  [-150, -106, -134, -104], // woolshed yard
];

export function clearOf(x: number, z: number, margin = 0): boolean {
  for (const [a, b, c, d] of CLEAR) if (x > a - margin && x < b + margin && z > c - margin && z < d + margin) return false;
  for (const zone of ZONES) if (Math.hypot(x - zone.x, z - zone.z) < (zone.clear ?? 7) + margin) return false;
  if (trackDistance(x, z).d < 1.2 + margin) return false;
  if (inStream(x, z, 5)) return false;
  return true;
}

type Animated = ((dt: number, t: number) => void)[];

export async function buildWorld(scene: THREE.Scene): Promise<WorldMap> {
  const colliders = new Colliders();
  colliders.bounds = { minX: WORLD.minX + 3, maxX: WORLD.maxX - 3, minZ: WORLD.minZ + 3, maxZ: WORLD.maxZ };
  const b = new Builder(scene, colliders);

  // Level the ground under games and buildings before anything reads heights.
  for (const zone of ZONES) if (zone.pad) addPad(zone.x, zone.z, zone.pad);
  addPad(HEADLAND.x, HEADLAND.z, 9);
  addPad(-128, -120, 16); // woolshed
  addPad(146, -147, 9); // waterfall pool
  // Decks: the main street's asphalt and footpaths, the jetty and the two bridges.
  addPlatform(STREET_X0 - 4, STREET_X1 + 4, STREET_Z - 2.48, STREET_Z + 2.48, ASPHALT - ROAD_SINK, 1.5);
  addPlatform(STREET_X0 - 4, STREET_X1 + 4, STREET_Z - 4, STREET_Z - 2.48, KERB_TOP, 1);
  addPlatform(STREET_X0 - 4, STREET_X1 + 4, STREET_Z + 2.48, STREET_Z + 4, KERB_TOP, 1);
  const JETTY = { x: -45, z0: waterline(-45) - 13, z1: 152, y: 0.55 };
  addPlatform(JETTY.x - 2.4, JETTY.x + 2.4, JETTY.z0, JETTY.z1 + 60, JETTY.y, 4);
  // The road bridge sits level with the higher bank, so neither end is buried.
  // The road bridge spans just the channel, level with the higher of its two banks.
  const bridgeX = streamX(STREET_Z);
  const roadBridgeY = Math.max(landHeight(bridgeX - 6.5, STREET_Z), landHeight(bridgeX + 6.5, STREET_Z), 0.4) + 0.2;
  addPlatform(bridgeX - 8.5, bridgeX + 8.5, STREET_Z - 2.2, STREET_Z + 2.2, roadBridgeY, 3);
  const footBridgeY = Math.max(landHeight(119, -100), landHeight(136, -100)) + 0.5;
  addPlatform(118, 137, -101.4, -98.6, footBridgeY, 3);
  // Stepping stones a little downstream: the one place to cross the stream without the bridge.
  const STONES = { z: -84, x: streamX(-84), half: streamHalf(-84) + 0.6, y: streamSurface(-84) + 0.1 };
  addPlatform(STONES.x - STONES.half, STONES.x + STONES.half, STONES.z - 0.55, STONES.z + 0.55, STONES.y, 1.2);

  // The world as data (paths, grass, water depth, sand, height) for the TSL shaders.
  const data = buildWorldData();
  scene.add(buildTerrain(data));
  scene.add(buildSea(data, quality.preset));
  scene.add(buildStream());
  scene.add(buildGrass(data, quality.preset));
  scene.add(buildFlowers(data, quality.preset));
  const buoyancy = new Buoyancy();
  floaters.length = 0;

  const walks: THREE.Vector2[][] = [];
  const animated: Animated = [];

  township(b, walks);
  bachRoad(b);
  park(b);
  beach(b);
  wharf(b, JETTY);
  campground(b);
  farm(b);
  bush(b, footBridgeY, animated);
  for (let x = STONES.x - STONES.half + 0.35, i = 0; x < STONES.x + STONES.half; x += 0.72, i++) {
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), paint(i % 2 ? '#8d918c' : '#7a7f7b'));
    stone.scale.set(1, 0.45, 0.95 + (i % 3) * 0.1);
    stone.rotation.y = i * 1.7;
    stone.position.set(x, STONES.y - 0.12, STONES.z + Math.sin(i * 2.3) * 0.12);
    stone.castShadow = stone.receiveShadow = true;
    b.scene.add(stone);
  }
  headland(b, roadBridgeY);
  vegetation(b);
  scene.add(buildClouds(animated));

  await b.done();
  for (const f of floaters) buoyancy.add(f, { draft: 0.35, tether: 2.5 });
  // Toys off the beach, between the gull spot and the patrolled flags: free to nudge around.
  const ball = P.beachBall();
  ball.position.set(-3, SEA_LEVEL, waterline(-3) + 9);
  scene.add(ball);
  buoyancy.add(ball, { draft: 0.22, tether: 6, push: 0.35 });
  for (const [x, dz, c] of [[-11, 13, '#ff7a1a'], [44, 11, '#27c4f5']] as [number, number, string][]) {
    const board = P.surfboard(c);
    board.position.set(x, SEA_LEVEL, waterline(x) + dz);
    board.rotation.y = rand(0, 6.28);
    scene.add(board);
    buoyancy.add(board, { draft: 0.05, tether: 4, push: 0.9 });
  }
  return {
    colliders,
    seats: b.seats,
    places: b.places,
    walks,
    lanes: [
      { from: new THREE.Vector3(STREET_X0 - 2, 0, STREET_Z - 1.3), to: new THREE.Vector3(STREET_X1 + 2, 0, STREET_Z - 1.3) },
      { from: new THREE.Vector3(STREET_X1 + 2, 0, STREET_Z + 1.3), to: new THREE.Vector3(STREET_X0 - 2, 0, STREET_Z + 1.3) },
    ],
    audit: () => b.audit(),
    update: (dt, elapsed) => {
      buoyancy.update(dt, elapsed, world.focal.value as THREE.Vector3);
      for (const fn of animated) fn(dt, elapsed);
    },
  };
}

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------

function township(b: Builder, walks: THREE.Vector2[][]): void {
  b.place('township', 'Township', 30, 20, 70);
  b.place('green', 'The green', 30, -10, 24);
  // Main street. Tiles are sunk so the asphalt sits just above the ground.
  const tiles: Placement[] = [];
  for (let x = STREET_X0 + 4; x < STREET_X1; x += 8) tiles.push({ x, z: STREET_Z, rot: Math.PI / 2, y: -ROAD_SINK });
  b.many('city/road_straight', { width: 8 }, tiles);
  // A zebra crossing by the green.
  for (let i = 0; i < 6; i++) b.add(box(0.42, 0.02, 2.4, '#f4f4ee'), 28 + i * 0.8, STREET_Z, 0, 0.012);

  // Shops down both sides, with gaps for the paths to the beach, the wharf and the green.
  const models = ['A', 'B', 'E', 'F', 'C', 'D', 'G', 'H'];
  let n = 0;
  const shop = (x: number, z: number, rot: number) => b.put(`city/building_${models[n++ % models.length]}_withoutBase`, x, z, { width: 8, rot, solid: true });
  for (let x = -52; x <= 110; x += 8.6) {
    if (Math.abs(x + 10) > 5.5 && Math.abs(x - 60) > 5.5 && Math.abs(x + 45) > 5.5) shop(x, STREET_Z + 9, Math.PI);
    if (x < 4 || x > 56) shop(x, STREET_Z - 9, 0);
  }
  // Street furniture stands on the footpath.
  const lights: Placement[] = [];
  for (let x = -54; x <= 112; x += 14) {
    lights.push({ x, z: STREET_Z - 3.6, rot: Math.PI / 2 }, { x: x + 7, z: STREET_Z + 3.6, rot: -Math.PI / 2 });
  }
  b.many('city/streetlight', { height: 4.2 }, lights, 0.2);
  for (const l of lights) b.add(glowBulb('#ffe9a3', 0.16), l.x + Math.cos(l.rot ?? 0) * 0.85, l.z - Math.sin(l.rot ?? 0) * 0.85, 0, 3.95);
  b.many('city/firehydrant', { height: 0.7 }, [{ x: -22, z: STREET_Z - 3.5 }, { x: 72, z: STREET_Z + 3.5 }], 0.25);
  b.many('city/trash_A', { height: 0.5 }, [{ x: 8, z: STREET_Z + 3.5 }, { x: 96, z: STREET_Z - 3.5 }], 0.3);
  // The street is two lanes, so cars park on the verge by the foreshore path instead.
  const cars = ['car_sedan', 'car_hatchback', 'car_stationwagon', 'car_taxi', 'car_police'];
  [[66, 40], [69.5, 40], [73, 40], [-16, 40], [-19.5, 40]].forEach(([x, z], i) => b.put(`city/${cars[i % cars.length]}`, x, z, { width: 4.2, rot: i % 2 ? Math.PI : 0, solid: true }));

  // The green: the big Christmas tree, presents, lanterns, benches.
  b.put('holiday/christmas_tree_decorated', 30, -12, { height: 8, solid: 2.2 });
  const presents = ['present_A_red', 'present_B_blue', 'present_C_green', 'present_D_yellow', 'present_E_white', 'present_sphere_A_red', 'present_F_red', 'present_A_green'];
  presents.forEach((name, i) => {
    const a = (i / presents.length) * Math.PI * 2;
    b.put(`holiday/${name}`, 30 + Math.sin(a) * 3.3, -12 + Math.cos(a) * 3.3, { width: 0.8 + (i % 3) * 0.2, rot: a * 2, solid: 0.45 });
  });
  for (const [x, z] of [[14, 6], [46, 6], [14, -28], [46, -28]]) {
    b.put('holiday/lantern', x, z, { height: 3.2, solid: 0.35 });
    b.add(glowBulb('#ffd27a', 0.22), x, z, 0, 2.05);
  }
  const benches: [number, number, number][] = [[22, -4, Math.PI / 2], [38, -4, -Math.PI / 2], [24, 8, Math.PI], [36, 8, Math.PI], [30, -24, 0], [-30, STREET_Z + 3.3, Math.PI], [84, STREET_Z - 3.3, 0]];
  for (const [x, z, yaw] of benches) bench(b, x, z, yaw);
  b.put('holiday/train_locomotive', 42, -20, { width: 2.4, rot: 0.5, solid: 1 });
  b.add(buildBillboard(), 16, -22, 0.5);
  b.colliders.box(16, -22, 3.6, 0.4, 0.5);
  b.add(P.signpost('Beach'), -10, STREET_Z + 5.5, Math.PI);
  b.add(P.signpost('Surf club'), 60, STREET_Z + 5.5, Math.PI);
  b.add(P.signpost('Bush walk'), 28, -30, 0);
  b.add(P.signpost('Wharf'), -45, STREET_Z + 5.5, Math.PI);

  // Footpath and green loops for strollers.
  walks.push([new THREE.Vector2(-56, STREET_Z - 3.3), new THREE.Vector2(112, STREET_Z - 3.3)]);
  walks.push([new THREE.Vector2(112, STREET_Z + 3.3), new THREE.Vector2(-56, STREET_Z + 3.3)]);
  walks.push([new THREE.Vector2(18, 2), new THREE.Vector2(42, 2), new THREE.Vector2(44, -20), new THREE.Vector2(30, -26), new THREE.Vector2(16, -18)]);
  walks.push([new THREE.Vector2(-10, 40), new THREE.Vector2(-10, 60), new THREE.Vector2(58, 62), new THREE.Vector2(56, 86), new THREE.Vector2(-6, 86)]);
}

function bench(b: Builder, x: number, z: number, yaw: number): void {
  b.add(P.parkBench(), x, z, yaw);
  b.colliders.box(x, z, 1.8, 0.6, yaw);
  // Two places to sit, facing the way the bench faces.
  for (const s of [-0.45, 0.45]) b.seat('bench', x + Math.cos(yaw) * s, z - Math.sin(yaw) * s, yaw, P.BENCH_SEAT);
}

function bachRoad(b: Builder): void {
  b.place('bach-road', 'Bach Road', -118, 8, 60);
  const baches: [number, string, string][] = [[-82, 'building_home_B_red', '#d7263d'], [-106, 'building_home_A_blue', '#2f6fd6'], [-130, 'building_home_B_yellow', '#e8a90f'], [-154, 'building_home_A_green', '#3e8e4e']];
  for (const [x, model, colour] of baches) {
    b.put(`hexagon/${model}`, x, 0, { height: 7.5, rot: Math.PI, solid: true });
    b.add(P.letterbox(colour), x + 7, 15.2);
    b.add(P.washingLine(), x - 6, -12);
    b.colliders.circle(x - 6, -12, 0.25);
    // Fenced back yard: back and sides, open towards the bach.
    yardFence(b, x - 11, -38, x + 11, -38);
    yardFence(b, x - 11, -38, x - 11, -8);
    yardFence(b, x + 11, -38, x + 11, -8);
  }
  // Our bach (the blue one): deck, table, the BBQ.
  const ox = -106;
  const deckH = 0.22;
  b.add(box(9, deckH, 4, '#b98a5a', 0, deckH / 2, 0), ox, 7);
  b.put('furniture/table_medium_long', ox + 2.4, 7, { width: 2.4, lift: deckH, solid: true });
  for (const s of [-1, 1]) {
    b.put('furniture/chair_A_wood', ox + 2.4, 7 + s * 1.05, { height: 1.05, rot: s > 0 ? Math.PI : 0, lift: deckH });
    b.seat('chair', ox + 2.4, 7 + s * 0.98, s > 0 ? Math.PI : 0, deckH + 0.5);
  }
  b.put('resource/Wood_Log_Stack', ox + 9, -34, { width: 2, rot: 1.2, solid: 1 });
  // Neighbours' yards get a bit of life too.
  b.add(P.surfboard('#27c4f5'), -80, -9, 0.4, 0.06);
  b.put('holiday/football', -128, -16, { width: 0.32 });
  b.put('mixedbag1/guitar_A', -152, 6.5, { height: 1.1, rot: 0.6 });
  b.put('holiday/christmas_tree', -150, -14, { height: 2.6, solid: 0.9 });
  const flaxes: Placement[] = [];
  for (const [x] of baches) for (let i = -9; i <= 9; i += 3.6) flaxes.push({ x: x + i + rand(-0.4, 0.4), z: -36.6, rot: rand(0, 6.28), scale: rand(0.9, 1.3) });
  flax(b, flaxes);
}

/** Harakeke clumps, dropped onto the ground. */
function flax(b: Builder, places: Placement[]): void {
  b.scene.add(P.flaxClumps(places.map((p) => ({ ...p, y: groundHeight(p.x, p.z) }))));
}

function yardFence(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(len / 2.2);
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const places: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    places.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rot: alongX ? Math.PI / 2 : 0 });
  }
  b.many('hexagon/fence_wood_straight', { width: 2.25 }, places);
  b.colliders.box((x0 + x1) / 2, (z0 + z1) / 2, alongX ? len : 0.3, alongX ? 0.3 : len);
}

function park(b: Builder): void {
  b.place('park', 'Foreshore park', 14, 62, 34);
  b.add(P.swingSet(), -2, 56, 0.3);
  b.colliders.box(-2, 56, 3.4, 1.2, 0.3);
  b.add(P.slide(), 8, 52, -0.4);
  b.colliders.box(8, 52.6, 1.2, 3.6, -0.4);
  b.put('platformer/spring_pad_blue', 3, 62, { width: 1.4 });
  b.put('holiday/basketball', 12, 60, { width: 0.4 });
  for (const [x, z, yaw] of [[-6, 64, Math.PI / 2], [16, 66, -Math.PI / 2], [34, 58, 0], [48, 70, Math.PI]] as [number, number, number][]) bench(b, x, z, yaw);
  for (const [x, z] of [[26, 50], [40, 52]]) {
    b.put('restaurant/table_round_A_small', x, z, { width: 1.6, solid: 0.8 });
    b.put('restaurant/chair_stool', x + 1.3, z, { height: 0.6 });
    b.put('restaurant/chair_stool', x - 1.3, z, { height: 0.6 });
  }
  // Surf club with its boards, and the second sponsor board.
  b.put('platformer/structure_C', 30, 80, { height: 4, solid: true });
  for (let i = 0; i < 4; i++) {
    const board = P.surfboard(['#ff7a1a', '#27c4f5', '#ffd23f', '#e8578e'][i]);
    board.rotation.x = Math.PI / 2 - 0.18;
    b.add(board, 26.6 + i * 0.6, 77.4, 0, 1.05);
    board.rotation.x = Math.PI / 2 - 0.18;
  }
  b.add(P.signpost('Surf Club', '#d7263d'), 35, 76.5, Math.PI);
  b.add(buildBillboard(), 46, 84, Math.PI + 0.2);
  b.colliders.box(46, 84, 3.6, 0.4, Math.PI + 0.2);
}

function beach(b: Builder): void {
  b.place('beach', 'Pōhutukawa Bay beach', 10, 100, 60);
  b.place('rock-pools', 'Rock pools', -178, 122, 22);
  // Pōhutukawa along the back of the beach, flowering crimson for Christmas.
  const trees: Placement[] = [];
  for (let x = -190; x <= 120; x += rand(7, 12)) {
    const z = waterline(x) - 31 - rand(0, 3);
    if (trackDistance(x, z).d < 2.5 || Math.abs(x - 30) < 7 || (x > -178 && x < -74 && z < 86)) continue;
    trees.push({ x, z, rot: rand(0, 6.28), scale: rand(0.95, 1.35) });
  }
  b.many('forest/Tree_2_A_Color1', { height: 6 }, trees, 0.6);
  b.scene.add(buildBlossom(trees, 6));
  // Umbrellas, towels and people's stuff.
  const colours = ['#d7263d', '#27c4f5', '#ffd23f', '#e8578e', '#3e8e4e', '#ff7a1a'];
  const spots: [number, number][] = ([-70, -30, -4, 38, 52, 78, 104, -110] as number[]).map((x, i) => [x, waterline(x) - 17.5 - (i % 3) * 2.2]);
  spots.forEach(([x, z], i) => {
    b.add(P.beachUmbrella(colours[i % colours.length]), x, z, rand(0, 6.28));
    b.colliders.circle(x, z, 0.15);
    const yaw = rand(-0.5, 0.5);
    b.put(`furniture/rug_rectangle_stripes_${i % 2 ? 'A' : 'B'}`, x + 1.5, z + 0.6, { width: 2, rot: yaw, ungrounded: true });
    b.seat('towel', x + 1.5, z + 0.6, yaw + Math.PI / 2, 0.06);
    if (i % 2) b.put('mixedbag1/waterbottle_A', x + 0.5, z + 1.4, { height: 0.32, ungrounded: true });
    else b.put('holiday/football', x + 2.8, z + 1.8, { width: 0.32, ungrounded: true });
  });
  // Patrolled swimming area: red-and-yellow flags and the patrol tower.
  b.add(P.patrolTower(), 21, 95);
  b.colliders.box(21, 95, 2.4, 2.4);
  b.seat('stand', 23.5, 96, Math.PI);
  // Rock pools at the western end.
  const rocks: Placement[] = [];
  for (let i = 0; i < 26; i++) rocks.push({ x: rand(-197, -160), z: waterline(-178) - rand(2, 22), rot: rand(0, 6.28), scale: rand(0.8, 2.6) });
  b.many('forest/Rock_1_A_Color1', { height: 1 }, rocks, 0.45);
}

function wharf(b: Builder, J: { x: number; z0: number; z1: number; y: number }): void {
  b.place('wharf', 'The wharf', J.x, 130, 28);
  const len = J.z1 - J.z0;
  const jetty = P.deck(len, 4.8, 3.2, false);
  jetty.position.set(J.x, J.y, (J.z0 + J.z1) / 2);
  b.scene.add(jetty);
  // Edge walls beyond the ramp so nobody walks off the side into the bay.
  b.colliders.box(J.x - 2.55, (J.z0 + 5 + J.z1) / 2, 0.3, len - 5);
  b.colliders.box(J.x + 2.55, (J.z0 + 5 + J.z1) / 2, 0.3, len - 5);
  b.colliders.box(J.x, J.z1 + 0.2, 5.4, 0.3);
  const onDeck = (model: string, dx: number, z: number, opts: { width?: number; height?: number }) => b.put(model, J.x + dx, z, { ...opts, solid: 0.4 });
  onDeck('hexagon/barrel', -1.7, 122, { height: 0.9 });
  onDeck('hexagon/crate_A_big', -1.6, 124, { width: 0.9 });
  onDeck('hexagon/crate_B_small', -1.5, 138, { width: 0.6 });
  onDeck('resource/Fuel_A_Jerrycan', 1.7, 131, { height: 0.5 });
  onDeck('hexagon/bucket_water', 1.6, 146.5, { height: 0.4 });
  for (const [dx, z, yaw] of [[1.9, 143, Math.PI / 2], [-1.9, 134, -Math.PI / 2], [0, J.z1 - 0.7, 0]] as [number, number, number][]) b.seat('fish', J.x + dx, z, yaw);
  for (const [dx, z, c] of [[5.5, 126, '#27c4f5'], [-6, 140, '#d7263d'], [7, 147, '#ffd23f']] as [number, number, string][]) {
    const boat = P.dinghy(c);
    boat.position.set(J.x + dx, SEA_LEVEL + 0.2, z);
    floaters.push(boat);
    boat.rotation.y = rand(0, 6.28);
    b.scene.add(boat);
  }
}

function campground(b: Builder): void {
  b.place('campground', 'Campground', -126, 58, 44);
  b.add(P.signpost('Campground'), -89, 27, Math.PI);
  const tents: Placement[] = [];
  for (const [x, z] of [[-104, 46], [-116, 72], [-140, 46], [-150, 74], [-172, 48], [-128, 76]]) tents.push({ x, z, rot: rand(0, 6.28), scale: rand(0.9, 1.15) });
  b.many('hexagon/tent', { width: 3.4 }, tents, 1.5);
  for (const [x, z, rot, c] of [[-106, 68, 0.2, '#27c4f5'], [-140, 70, -0.3, '#ff7a1a'], [-170, 68, 0.1, '#3e8e4e']] as [number, number, number, string][]) {
    b.add(P.caravan(c), x, z, rot);
    b.colliders.box(x, z, 4.3, 2.2, rot);
  }
  b.add(P.bbqShelter(), -126, 50);
  b.colliders.box(-126, 48.8, 1.7, 0.8);
  b.put('restaurant/table_round_A_small', -126, 51, { width: 1.5, solid: 0.75 });
  b.put('mixedbag1/circus_tent', -156, 46, { width: 6.5, solid: 3 });
  b.put('mixedbag1/woodstove', -118, 46, { height: 1, solid: 0.4 });
  b.put('mixedbag1/guitar_B', -120.6, 46.6, { height: 1.05, rot: 1 });
  b.seat('ground', -119.8, 44.4, 0.5);
  b.seat('ground', -116.4, 44.6, -0.5);
  b.many('hexagon/crate_A_small', { width: 0.6 }, [{ x: -103, z: 49 }, { x: -139, z: 49.5 }, { x: -171, z: 51 }], 0.35);
}

function farm(b: Builder): void {
  b.place('farm', 'The farm', -128, -116, 60);
  b.add(P.signpost('Farm stay'), -127, -62, 0);
  b.add(P.woolshed(), -128, -124);
  b.colliders.box(-128, -124, 10.2, 7.2);
  b.put('hexagon/building_windmill_red', -152, -150, { height: 13, solid: 3 });
  b.put('hexagon/building_grain', -110, -126, { width: 5, solid: 2.4 });
  b.put('city/car_hatchback', -120, -111, { width: 4, rot: -1.2, solid: true });
  b.put('hexagon/wheelbarrow', -134, -113, { width: 1.4, rot: 0.8, solid: 0.5 });
  b.put('city/watertower', -146, -118, { height: 6, solid: 1.3 });
  b.seat('work', -137, -110.5, 2.2);
  for (let i = 0; i < 7; i++) {
    const x = -112 + (i % 3) * 1.8;
    const z = -136 - Math.floor(i / 3) * 1.6;
    b.add(P.hayBale(), x, z, Math.PI / 2);
    b.colliders.circle(x, z, 0.8);
  }
  // Paddocks: post-and-wire fences laid in short runs so they follow the rolling ground.
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 8);
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n;
      const az = z0 + ((z1 - z0) * i) / n;
      const bx = x0 + ((x1 - x0) * (i + 1)) / n;
      const bz = z0 + ((z1 - z0) * (i + 1)) / n;
      const seg = P.wireFence(len / n);
      const ya = groundHeight(ax, az);
      const yb = groundHeight(bx, bz);
      seg.rotation.order = 'YZX';
      seg.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2);
      seg.rotation.y = yaw;
      seg.rotation.z = Math.atan2(yb - ya, len / n);
      b.scene.add(seg);
    }
    b.colliders.box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.3, Math.abs(z1 - z0) + 0.3);
  };
  run(-200, -72, -136, -72);
  run(-124, -72, -62, -72);
  run(-62, -72, -62, -170);
  run(-200, -100, -158, -100);
  run(-100, -100, -62, -100);
}

function bush(b: Builder, footBridgeY: number, animated: Animated): void {
  b.place('bush', 'Bush reserve', 60, -110, 70);
  b.place('waterfall', 'Waterfall', 146, -146, 18);
  const fb = P.deck(19, 2.4, 2, true);
  fb.rotation.y = Math.PI / 2;
  fb.position.set(127.5, footBridgeY, -100);
  b.scene.add(fb);
  b.colliders.box(127.5, -101.45, 13, 0.3);
  b.colliders.box(127.5, -98.55, 13, 0.3);
  const fall = P.waterfall();
  b.add(fall.object, 146, -153, 0);
  b.colliders.box(146, -156, 16, 5);
  animated.push((_dt, t) => {
    const pos = fall.water.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getY(i) * 3 + t * 9) * 0.07);
    pos.needsUpdate = true;
  });
  bench(b, 138, -143, -Math.PI / 2);
  b.add(P.signpost('Waterfall'), 122, -104, Math.PI / 2);
  b.add(P.signpost('Trap line'), 38, -92, 0);
  b.many('resource/Wood_Log_B', { width: 1.6 }, [{ x: 33, z: -108, rot: 0.4 }, { x: 47.5, z: -108.5, rot: -0.5 }], 0.5);
}

function headland(b: Builder, roadBridgeY: number): void {
  b.place('headland', 'Lighthouse', HEADLAND.x, HEADLAND.z, 34);
  b.place('estuary', 'Stream bridge', 140, 20, 16);
  const bx = streamX(STREET_Z);
  const rb = P.deck(15, 4.4, 4.5, true);
  rb.rotation.y = Math.PI / 2;
  rb.position.set(bx, roadBridgeY, STREET_Z);
  b.scene.add(rb);
  b.colliders.box(bx, STREET_Z - 2.3, 13, 0.3);
  b.colliders.box(bx, STREET_Z + 2.3, 13, 0.3);
  b.add(P.signpost('One lane', '#b3541e'), 125, STREET_Z - 4, -Math.PI / 2);
  b.add(P.signpost('Lighthouse'), 154, 25, -Math.PI / 2);
  b.add(P.lighthouse(), HEADLAND.x + 3, HEADLAND.z + 3);
  b.colliders.circle(HEADLAND.x + 3, HEADLAND.z + 3, 2.8);
  b.add(P.trigPoint(), HEADLAND.x - 5, HEADLAND.z - 4);
  b.colliders.circle(HEADLAND.x - 5, HEADLAND.z - 4, 0.7);
  bench(b, HEADLAND.x - 2, HEADLAND.z + 8, 0);
  bench(b, HEADLAND.x - 7.5, HEADLAND.z + 3, -Math.PI / 2);
  const rocks: Placement[] = [];
  for (let i = 0; i < 40; i++) {
    const a = rand(0, 6.28);
    const r = rand(14, HEADLAND.radius);
    const x = HEADLAND.x + Math.cos(a) * r;
    const z = HEADLAND.z + Math.sin(a) * r;
    if (trackDistance(x, z).d < 2 || x > WORLD.maxX - 6 || groundHeight(x, z) < 0 || !clearOf(x, z, 1.5)) continue;
    rocks.push({ x, z, rot: rand(0, 6.28), scale: rand(0.8, 2.4) });
  }
  b.many('forest/Rock_1_A_Color1', { height: 1 }, rocks, 0.45);
}

/** Trees, bushes, rocks, grass and flax scattered by biome, keeping clear of everything built. */
function vegetation(b: Builder): void {
  const treeModels = ['forest/Tree_1_A_Color1', 'forest/Tree_2_A_Color1', 'forest/Tree_3_A_Color1', 'forest/Tree_4_A_Color1', 'forest/Tree_1_B_Color1', 'forest/Tree_2_B_Color1'];
  const sets = new Map<string, Placement[]>(treeModels.map((m) => [m, []]));
  const plant = (x: number, z: number, height: number) => {
    if (!clearOf(x, z, 1.5) || groundHeight(x, z) < 0.05) return;
    sets.get(pick(treeModels))!.push({ x, z, rot: rand(0, 6.28), scale: height / 5 });
    b.colliders.circle(x, z, 0.5 * (height / 5));
  };
  for (let i = 0; i < 620; i++) plant(rand(-40, 205), rand(-182, -66), rand(4.5, 9)); // bush reserve
  for (let x = -200; x <= -66; x += rand(5, 8)) plant(x, rand(-182, -174), rand(6, 9)); // shelter belt
  for (let i = 0; i < 26; i++) plant(rand(-200, -66), rand(-170, -76), rand(4, 7)); // farm
  for (let i = 0; i < 90; i++) plant(rand(-200, 124), rand(-62, 84), rand(4, 6.5)); // around town
  for (const [x, z] of [[20, 46], [44, 46], [-14, 70], [2, 76], [52, 58], [-96, 56], [-134, 60], [-158, 56], [-98, 78], [-146, 80]]) {
    sets.get(treeModels[1])!.push({ x, z, rot: rand(0, 6.28), scale: rand(1, 1.3) });
    b.colliders.circle(x, z, 0.6);
  }
  for (let z = -180; z <= 60; z += rand(5, 9)) plant(rand(-207, -201), z, rand(6, 9));
  for (const [model, places] of sets) b.many(model, { height: 5 }, places);

  const bushes: Placement[] = [];
  const rocks: Placement[] = [];
  const grass: Placement[] = [];
  const flaxClumps: Placement[] = [];
  for (let i = 0; i < 520; i++) {
    const x = rand(WORLD.minX, WORLD.maxX);
    const z = rand(WORLD.minZ, 96);
    const biome = biomeAt(x, z);
    if (!clearOf(x, z) || biome === 'sea' || biome === 'beach') continue;
    if (biome === 'bush' || rng() < 0.4) bushes.push({ x, z, rot: rand(0, 6.28), scale: rand(0.7, 1.5) });
    else if (biome === 'headland' || rng() < 0.12) rocks.push({ x, z, rot: rand(0, 6.28), scale: rand(0.6, 1.8) });
  }
  for (let i = 0; i < 1500; i++) {
    const x = rand(WORLD.minX, WORLD.maxX);
    const z = rand(WORLD.minZ, 100);
    const biome = biomeAt(x, z);
    if (biome === 'sea' || biome === 'beach' || trackDistance(x, z).d < 0.4 || (Math.abs(z - STREET_Z) < 14 && x > STREET_X0 - 4 && x < STREET_X1 + 4)) continue;
    grass.push({ x, z, rot: rand(0, 6.28), scale: rand(0.7, biome === 'farm' ? 1.9 : 1.4) });
  }
  // Harakeke along the stream banks and the dunes.
  // Harakeke on the stream banks, just above the water.
  for (let z = STREAM_Z0 + 4; z < STREAM_Z1 - 6; z += rand(3, 6)) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = streamX(z) + side * (streamHalf(z) + rand(1.4, 3.2));
    if (Math.abs(z - STREET_Z) < 5 || Math.abs(z + 100) < 4 || groundHeight(x, z) < streamSurface(z) + 0.1) continue;
    flaxClumps.push({ x, z, rot: rand(0, 6.28), scale: rand(0.85, 1.25) });
  }
  for (let x = -190; x < 118; x += rand(4, 9)) flaxClumps.push({ x, z: waterline(x) - 26 + rand(-2, 2), rot: rand(0, 6.28), scale: rand(0.8, 1.15) });
  b.many('forest/Bush_1_A_Color1', { height: 1 }, bushes.filter((_, i) => i % 2 === 0));
  b.many('forest/Bush_2_B_Color1', { height: 1.1 }, bushes.filter((_, i) => i % 2 === 1));
  b.many('forest/Rock_1_A_Color1', { height: 1 }, rocks, 0.45);
  void grass; // the GPU grass (ground.ts) replaces the scattered tufts
  flax(b, flaxClumps);
}

// ---------------------------------------------------------------------------
// Ground, water, sky dressing
// ---------------------------------------------------------------------------

function buildTerrain(data: WorldData): THREE.Mesh {
  const pad = 70;
  const w = WORLD.maxX - WORLD.minX + pad * 2;
  const d = WORLD.maxZ - WORLD.minZ + pad * 2;
  const step = 2;
  const geo = new THREE.PlaneGeometry(w, d, Math.round(w / step), Math.round(d / step));
  geo.rotateX(-Math.PI / 2);
  geo.translate((WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.minZ + WORLD.maxZ) / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const C = (hex: string) => new THREE.Color(hex);
  const grass = C('#7fc35c');
  const grassDark = C('#5d9f47');
  const paddock = C('#a9c95a');
  const bushFloor = C('#4f8a40');
  const sand = C('#f1dcae');
  const wetSand = C('#cdb382');
  const streamBed = C('#6f7a52');
  const gravel = C('#cfc4ae');
  const dirt = C('#b9925f');
  const rock = C('#8d9197');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let h = landHeight(x, z);
    // Beyond the playable edge the land climbs into hills that hide the horizon.
    const out = Math.max(WORLD.minX - x, x - WORLD.maxX, WORLD.minZ - z, 0);
    if (out > 0 && z < waterline(x) - 20) h += out * 0.35 + (fbm(x * 0.03, z * 0.03) - 0.4) * out * 0.25;
    pos.setY(i, h);

    const n = fbm(x * 0.09, z * 0.09);
    const biome = biomeAt(x, z);
    c.copy(grass).lerp(grassDark, THREE.MathUtils.clamp(n * 1.1 - 0.15, 0, 1));
    if (biome === 'farm') c.lerp(paddock, 0.6 + n * 0.3);
    if (biome === 'bush') c.lerp(bushFloor, 0.75);
    if (biome === 'headland') c.lerp(rock, THREE.MathUtils.smoothstep(h, 9, 17) * 0.55);
    const wl = waterline(x);
    const shield = Math.exp(-((x - HEADLAND.x) ** 2 + (z - HEADLAND.z) ** 2) / (36 * 36));
    c.lerp(sand, THREE.MathUtils.smoothstep(z, wl - 30, wl - 25) * (1 - shield));
    c.lerp(wetSand, THREE.MathUtils.smoothstep(z, wl - 6, wl + 2));
    if (inStream(x, z, 0.3)) c.lerp(streamBed, 0.85); // under the stream: hidden by the water
    const { d: td, track } = trackDistance(x, z);
    if (track) c.lerp(track.kind === 'gravel' ? gravel : dirt, (1 - THREE.MathUtils.smoothstep(td, -0.5, 0.9)) * 0.92);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, terrainMaterial(data));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Crimson flower clusters for the pōhutukawa canopies (they are December-red). */
function buildBlossom(trees: Placement[], height: number): THREE.InstancedMesh {
  const perTree = 24;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: '#d7263d' }), trees.length * perTree);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const t of trees) {
    const s = t.scale ?? 1;
    const base = groundHeight(t.x, t.z);
    for (let k = 0; k < perTree; k++) {
      const a = rng() * Math.PI * 2;
      const up = 0.55 + rng() * 0.38;
      const r = 1.9 * s * (0.55 + rng() * 0.45) * (1.1 - up * 0.5);
      const sc = 0.7 + rng() * 0.9;
      m.makeScale(sc, sc, sc).setPosition(t.x + Math.cos(a) * r, base + height * s * up, t.z + Math.sin(a) * r);
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.castShadow = true;
  return mesh;
}

function buildClouds(animated: Animated): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, fog: false });
  const puffs: THREE.Group[] = [];
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(7, 13), 1), mat);
      puff.position.set(k * rand(7, 10), rand(-1.5, 1.5), rand(-4, 4));
      puff.scale.y = 0.5;
      cloud.add(puff);
    }
    cloud.position.set(rand(-480, 480), rand(75, 120), rand(-420, 420));
    g.add(cloud);
    puffs.push(cloud);
  }
  animated.push((dt) => {
    for (const p of puffs) {
      p.position.x += dt * 2.2;
      if (p.position.x > 500) p.position.x = -500;
    }
  });
  return g;
}

/** The only brand placement in the world: two "presented by" boards (see docs/compliance.md). */
function buildBillboard(): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0, '#1b2440');
  grad.addColorStop(1, '#2b3a6b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);
  brand.palette.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(120 + i * 160, 440, 34, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '600 44px Nunito, system-ui, sans-serif';
  ctx.fillText('Kiwi Christmas Games', 512, 110);
  ctx.font = '700 104px Fredoka, system-ui, sans-serif';
  ctx.fillText(brand.presenter, 512, 250);
  ctx.font = '600 52px Fredoka, system-ui, sans-serif';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(brand.campaign, 512, 330);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const side = new THREE.MeshLambertMaterial({ color: '#1b2440' });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 0.12), [side, side, side, side, new THREE.MeshBasicMaterial({ map: tex }), side]);
  board.position.y = 2.3;
  board.castShadow = true;
  return new THREE.Group().add(board, cyl(0.07, 0.07, 1.6, '#7a5a3a', -1.4, 0.8, 0, 6), cyl(0.07, 0.07, 1.6, '#7a5a3a', 1.4, 0.8, 0, 6));
}
