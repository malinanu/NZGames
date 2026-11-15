import * as THREE from 'three';

/**
 * The shape of the land, as one analytic function so everything (player, NPCs, props, roads)
 * agrees on where the ground is. North is -Z; the sea is to the south.
 *
 *   flat coastal plain   township, bach road, campground
 *   north-west           rolling farmland
 *   north / north-east   hilly native bush, with a stream running out to the estuary
 *   east                 the headland, climbing to the lighthouse
 *   south                dunes, the beach, the bay
 */
export const WORLD = { minX: -210, maxX: 210, minZ: -185, maxZ: 175 };
export const SEA_LEVEL = -0.7;
/** Deepest the player may wade. */
export const WADE_DEPTH = -1.15;

/** Z of the waterline at a given X: the bay curves in at the middle. */
export function waterline(x: number): number {
  return 112 + x * x * 0.0008;
}

/** Centre of the stream at a given Z (it runs roughly north-south, east of town). */
export function streamX(z: number): number {
  return 132 + Math.sin(z / 34) * 11 + Math.sin(z / 13) * 2.5;
}

export const HEADLAND = { x: 178, z: 78, height: 19, radius: 44 };

function hash(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number): number {
  return noise(x, z) * 0.55 + noise(x * 2.1 + 17, z * 2.1 - 9) * 0.3 + noise(x * 4.3 - 5, z * 4.3 + 31) * 0.15;
}

const smooth = THREE.MathUtils.smoothstep;

/** 1 on the flat coastal plain, falling to 0 where the hills begin. */
function plain(x: number, z: number): number {
  const north = smooth(z, -92, -62);
  const east = 1 - smooth(x, 120, 150);
  return north * east;
}

/** Land height before pads, platforms and the stream. */
function rawHeight(x: number, z: number): number {
  const hills = 1 - plain(x, z);
  // Farmland (west) rolls gently; the bush (east) is steeper.
  const bushiness = smooth(x, -70, -10);
  const amp = THREE.MathUtils.lerp(4.5, 11, bushiness);
  let h = hills * (fbm(x * 0.018 + 3, z * 0.018 - 7) - 0.32) * amp;
  h = Math.max(h, -0.2 * hills);
  // Land rises steadily towards the northern edge so the world feels cupped by hills.
  h += smooth(-z, 120, 190) * 7 * hills;
  // The headland.
  const dx = x - HEADLAND.x;
  const dz = z - HEADLAND.z;
  h += HEADLAND.height * Math.exp(-(dx * dx + dz * dz) / (HEADLAND.radius * HEADLAND.radius));
  // Low dunes behind the beach, then the sand slopes into the sea.
  const w = waterline(x);
  h += Math.exp(-(((z - (w - 27)) / 3.2) ** 2)) * (0.5 + noise(x * 0.15, 3) * 0.7) * plain(x, z);
  const slope = Math.max(0, z - (w - 14)) * 0.05;
  const headlandShield = Math.exp(-(dx * dx + dz * dz) / (30 * 30));
  h -= slope * (1 - headlandShield * 0.9);
  return h;
}

interface Pad {
  x: number;
  z: number;
  r: number;
  y: number;
}
interface Platform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  /** Length of the ramp at each end along the long axis. */
  ramp: number;
}

const pads: Pad[] = [];
const platforms: Platform[] = [];

/** Levels a disc of ground (blended at the rim) so a game or building sits flat. */
export function addPad(x: number, z: number, r: number): number {
  const y = Math.max(rawHeight(x, z), 0.05);
  pads.push({ x, z, r, y });
  return y;
}

/** A walkable deck above the ground or water: the jetty and the bridges. */
export function addPlatform(minX: number, maxX: number, minZ: number, maxZ: number, y: number, ramp = 3): void {
  platforms.push({ minX, maxX, minZ, maxZ, y, ramp });
}

/** Height of the land itself (what the terrain mesh shows). */
export function landHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r * 1.6) h = THREE.MathUtils.lerp(p.y, h, smooth(d, p.r, p.r * 1.6));
  }
  // The stream cuts a shallow bed on its way to the estuary.
  const sd = Math.abs(x - streamX(z));
  if (sd < 9 && z > -160) h -= 1.5 * Math.exp(-((sd / 3.4) ** 2)) * smooth(z, -160, -140);
  return h;
}

/** Where feet go: the land, or a deck if you are on one. */
export function groundHeight(x: number, z: number): number {
  const land = landHeight(x, z);
  let h = land;
  for (const p of platforms) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const alongZ = p.maxZ - p.minZ > p.maxX - p.minX;
    const t = alongZ ? Math.min(z - p.minZ, p.maxZ - z) : Math.min(x - p.minX, p.maxX - x);
    const deck = THREE.MathUtils.lerp(land, p.y, Math.min(1, t / p.ramp));
    h = Math.max(h, Math.max(deck, land));
  }
  return h;
}

/** Water surface height of the stream at this point, or null away from it. */
export function streamSurface(z: number): number {
  const x = streamX(z);
  return Math.max(SEA_LEVEL, rawHeight(x + 9, z) - 0.55);
}

export function walkable(x: number, z: number): boolean {
  if (x < WORLD.minX + 4 || x > WORLD.maxX - 4 || z < WORLD.minZ + 4) return false;
  return groundHeight(x, z) > WADE_DEPTH;
}

export type Biome = 'town' | 'beach' | 'farm' | 'bush' | 'headland' | 'sea';

export function biomeAt(x: number, z: number): Biome {
  if (z > waterline(x) - 4) return 'sea';
  if (z > waterline(x) - 30) return 'beach';
  if (Math.hypot(x - HEADLAND.x, z - HEADLAND.z) < HEADLAND.radius * 1.3) return 'headland';
  if (z < -70) return x < -45 ? 'farm' : 'bush';
  return 'town';
}
