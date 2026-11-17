import * as THREE from 'three';
import { biomeAt, groundHeight, inStream, landHeight, SEA_LEVEL, streamSurface, waterline, WORLD } from './terrain';
import { clearOf, STREET_X0, STREET_X1, STREET_Z, trackDistance } from './map';

/**
 * The world as data. One RGBA texture covers the whole map:
 *   R  paths and gravel tracks (1 = on a path)
 *   G  grass density (0 = bare: roads, sand, decks, game pads)
 *   B  water depth (0 = dry, 1 = 4 m or deeper)
 *   A  sand (1 = beach)
 * plus a matching float texture of ground height. Shaders read these to colour the ground,
 * plant grass and draw shore ripples, the way Bruno Simon paints his in Blender; ours is
 * generated from the terrain functions instead, so it always matches the collision ground.
 */
export const DATA_SIZE = 512;
/** World rectangle the textures cover (slightly larger than the walkable area). */
export const DATA_BOUNDS = { minX: WORLD.minX - 20, maxX: WORLD.maxX + 20, minZ: WORLD.minZ - 20, maxZ: WORLD.maxZ + 80 };

export interface WorldData {
  data: THREE.DataTexture;
  height: THREE.DataTexture;
  /** CPU copies for lookups (grass placement, flowers, buoyancy). */
  rgba: Uint8Array;
  heights: Float32Array;
  sample(x: number, z: number): { path: number; grass: number; depth: number; sand: number; height: number };
}

let cached: WorldData | null = null;

export function buildWorldData(): WorldData {
  if (cached) return cached;
  const N = DATA_SIZE;
  const rgba = new Uint8Array(N * N * 4);
  const heights = new Float32Array(N * N);
  const { minX, maxX, minZ, maxZ } = DATA_BOUNDS;
  for (let j = 0; j < N; j++) {
    const z = minZ + ((j + 0.5) / N) * (maxZ - minZ);
    for (let i = 0; i < N; i++) {
      const x = minX + ((i + 0.5) / N) * (maxX - minX);
      const k = j * N + i;
      const land = landHeight(x, z);
      const ground = groundHeight(x, z);
      heights[k] = ground;
      const { d: track } = trackDistance(x, z);
      const path = 1 - THREE.MathUtils.smoothstep(track, -0.4, 0.8);
      const biome = biomeAt(x, z);
      const onStreet = Math.abs(z - STREET_Z) < 4.2 && x > STREET_X0 - 4 && x < STREET_X1 + 4;
      const sand = THREE.MathUtils.smoothstep(z, waterline(x) - 30, waterline(x) - 25);
      let depth = Math.max(0, SEA_LEVEL - land);
      if (inStream(x, z, 0.6)) depth = Math.max(depth, streamSurface(z) - land);
      let grass = biome === 'bush' ? 0.75 : biome === 'farm' ? 1 : biome === 'headland' ? 0.7 : biome === 'town' ? 0.85 : 0;
      grass *= (1 - path) * (1 - sand) * (depth > 0 ? 0 : 1) * (onStreet ? 0 : 1) * (ground - land > 0.05 ? 0 : 1);
      if (!clearOf(x, z, -3)) grass *= 0.5; // thinner around buildings and game areas
      rgba[k * 4] = Math.round(path * 255);
      rgba[k * 4 + 1] = Math.round(THREE.MathUtils.clamp(grass, 0, 1) * 255);
      rgba[k * 4 + 2] = Math.round(THREE.MathUtils.clamp(depth / 4, 0, 1) * 255);
      rgba[k * 4 + 3] = Math.round(sand * 255);
    }
  }
  const data = new THREE.DataTexture(rgba, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  data.magFilter = THREE.LinearFilter;
  data.minFilter = THREE.LinearFilter;
  data.needsUpdate = true;
  const height = new THREE.DataTexture(heights, N, N, THREE.RedFormat, THREE.FloatType);
  height.magFilter = THREE.NearestFilter;
  height.minFilter = THREE.NearestFilter;
  height.needsUpdate = true;
  const sample = (x: number, z: number) => {
    const i = THREE.MathUtils.clamp(Math.floor(((x - minX) / (maxX - minX)) * N), 0, N - 1);
    const j = THREE.MathUtils.clamp(Math.floor(((z - minZ) / (maxZ - minZ)) * N), 0, N - 1);
    const k = j * N + i;
    return { path: rgba[k * 4] / 255, grass: rgba[k * 4 + 1] / 255, depth: (rgba[k * 4 + 2] / 255) * 4, sand: rgba[k * 4 + 3] / 255, height: heights[k] };
  };
  cached = { data, height, rgba, heights, sample };
  return cached;
}
