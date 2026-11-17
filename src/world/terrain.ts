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
  // The stream runs in a channel cut below its own water level, with soft banks either side.
  if (z > STREAM_Z0 - 6 && z < STREAM_Z1 + 6) {
    const sd = Math.abs(x - streamX(z));
    const half = streamHalf(z);
    if (sd < half + BANK + 1) {
      const fade = smooth(z, STREAM_Z0 - 6, STREAM_Z0);
      const cap = streamSurface(z) - BED_DEPTH + smooth(sd, half - 0.6, half + BANK) * (BANK + 2);
      if (cap < h) h = THREE.MathUtils.lerp(h, cap, fade);
    }
  }
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

// ---------------------------------------------------------------------------
// The stream: from the waterfall pool down to the estuary.
// ---------------------------------------------------------------------------
export const STREAM_Z0 = -150;
export const STREAM_Z1 = 116;
/** How far the bed sits below the water, and how wide the bank slope is. */
const BED_DEPTH = 0.55;
const BANK = 4;

/** Half the width of the water at this Z: a creek in the bush, wider at the estuary. */
export function streamHalf(z: number): number {
  return 2.6 + smooth(z, 40, 110) * 5;
}

/**
 * Water level along the stream, one sample per metre. Built from the land along the centre
 * line, smoothed, then forced to only ever go downhill towards the sea, so the water always
 * sits below both banks and never flows uphill.
 */
let levels: Float32Array | null = null;
function streamLevels(): Float32Array {
  if (levels) return levels;
  const n = STREAM_Z1 - STREAM_Z0 + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = STREAM_Z0 + i;
    const x = streamX(z);
    const half = streamHalf(z);
    // The lowest of the centre and both bank tops, so neither bank ends up below the water.
    raw[i] = Math.min(rawHeight(x, z), rawHeight(x - half - 1, z), rawHeight(x + half + 1, z)) - 0.35;
  }
  const out = new Float32Array(n);
  const R = 6;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - R); k <= Math.min(n - 1, i + R); k++) {
      sum += raw[k];
      count++;
    }
    out[i] = Math.min(sum / count, raw[i]);
  }
  for (let i = 1; i < n; i++) out[i] = Math.min(out[i], out[i - 1] - 0.005);
  for (let i = 0; i < n; i++) out[i] = Math.max(out[i], SEA_LEVEL);
  levels = out;
  return out;
}

/** Water surface height of the stream at this Z. */
export function streamSurface(z: number): number {
  const L = streamLevels();
  const t = THREE.MathUtils.clamp(z - STREAM_Z0, 0, L.length - 1);
  const i = Math.floor(t);
  const j = Math.min(i + 1, L.length - 1);
  return L[i] + (L[j] - L[i]) * (t - i);
}

/** True inside the stream's water (not counting decks over it). */
export function inStream(x: number, z: number, margin = 0): boolean {
  if (z < STREAM_Z0 || z > STREAM_Z1) return false;
  return Math.abs(x - streamX(z)) < streamHalf(z) + margin;
}

export function walkable(x: number, z: number): boolean {
  if (x < WORLD.minX + 4 || x > WORLD.maxX - 4 || z < WORLD.minZ + 4) return false;
  const g = groundHeight(x, z);
  if (g <= WADE_DEPTH) return false;
  // The stream is too deep to wade: cross on a bridge.
  if (inStream(x, z, 0.2) && g < streamSurface(z) - 0.1) return false;
  return true;
}

export type Biome = 'town' | 'beach' | 'farm' | 'bush' | 'headland' | 'sea';

export function biomeAt(x: number, z: number): Biome {
  if (z > waterline(x) - 4) return 'sea';
  if (z > waterline(x) - 30) return 'beach';
  if (Math.hypot(x - HEADLAND.x, z - HEADLAND.z) < HEADLAND.radius * 1.3) return 'headland';
  if (z < -70) return x < -45 ? 'farm' : 'bush';
  return 'town';
}
