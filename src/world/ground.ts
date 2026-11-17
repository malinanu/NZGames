import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshLambertNodeMaterial } from 'three/webgpu';
import { attribute, color, cos, float, mix, positionGeometry, positionWorld, sin, smoothstep, step, texture, uv, vec2, vec3 } from 'three/tsl';
import { world } from '../engine/tsl';
import type { QualityPreset } from '../engine/quality';
import { hashString, mulberry32 } from '../shared/rng';
import { DATA_BOUNDS, type WorldData } from './dataTexture';

// TSL node types are deeply generic; the helpers below take any float-valued node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FloatNode = any;

/** UV into the world data textures for a world-space XZ node. */
export const worldUv = (x: FloatNode, z: FloatNode) =>
  vec2(x.sub(DATA_BOUNDS.minX).div(DATA_BOUNDS.maxX - DATA_BOUNDS.minX), z.sub(DATA_BOUNDS.minZ).div(DATA_BOUNDS.maxZ - DATA_BOUNDS.minZ));

/**
 * Terrain material: the baked vertex colours give each biome its broad colour; the data
 * texture then paints crisp paths and gravel on top (the vertex grid is 2 m, the texture
 * about 0.8 m, so tracks no longer look smudged).
 */
export function terrainMaterial(data: WorldData): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial();
  const d = texture(data.data, worldUv(positionWorld.x, positionWorld.z));
  const base = attribute('color', 'vec3');
  const gravel = color('#cfc2a6');
  // Gravel edges break up a little so paths don't look ruled with a pen.
  const grain = sin(positionWorld.x.mul(3.1)).mul(sin(positionWorld.z.mul(2.7))).mul(0.06);
  m.colorNode = mix(base, gravel.add(grain), smoothstep(float(0.35), float(0.75), d.r).mul(0.92));
  return m;
}

/**
 * Grass: one blade shape drawn tens of thousands of times in a 64 m patch that travels with
 * the player. Each blade's spot wraps round the patch, reads the data texture for density
 * and the height texture for the ground, and sways in the wind. Low quality uses fewer,
 * wider blades (the same trade Bruno Simon makes).
 */
export function buildGrass(data: WorldData, preset: QualityPreset): THREE.Mesh {
  const PATCH = 64;
  const count = preset.grassBlades;
  const w = 0.07 * preset.grassWidth;
  // A tapered blade: base quad, narrowing to a tip. y runs 0..1.
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.6, 0.55, 0, w * 0.6, 0.55, 0, 0, 1, 0], 3));
  shape.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = shape.index;
  geo.setAttribute('position', shape.getAttribute('position'));
  const offsets = new Float32Array(count * 4);
  const rng = mulberry32(hashString('grass'));
  for (let i = 0; i < count; i++) offsets.set([rng() * PATCH, rng() * PATCH, rng(), rng()], i * 4);
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
  geo.instanceCount = count;

  const off = attribute('aOffset', 'vec4');
  // Wrap each blade's spot so the patch is always centred on the player.
  const rel = vec2(off.x, off.y).sub(vec2(world.focal.x, world.focal.z)).add(PATCH / 2).mod(PATCH).sub(PATCH / 2);
  const wx = world.focal.x.add(rel.x);
  const wz = world.focal.z.add(rel.y);
  const uvw = worldUv(wx, wz);
  const d = texture(data.data, uvw);
  const ground = texture(data.height, uvw).r;
  // Fade out towards the patch edge so its boundary never shows.
  const edge = float(1).sub(smoothstep(float(PATCH * 0.36), float(PATCH * 0.5), rel.length()));
  // No blades where filtering bleeds grass density onto the sand.
  const size = step(off.w, d.g).mul(step(d.a, float(0.04))).mul(edge).mul(off.z.mul(0.6).add(0.55));
  const angle = off.z.mul(6.283);
  const p = positionGeometry;
  const wind = sin(world.time.mul(1.8).add(wx.mul(0.21)).add(wz.mul(0.17))).mul(0.12).mul(p.y.mul(p.y));
  const height = float(0.42).mul(size);
  const local = vec3(p.x.mul(cos(angle)), p.y.mul(height), p.x.mul(sin(angle)));
  const m = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  m.positionNode = vec3(wx.add(local.x).add(wind), ground.add(local.y).sub(0.02), wz.add(local.z).add(wind.mul(0.6)));
  // Unlit (cheap) but tinted by the time of day, dark at the root and light at the tip.
  const tint = mix(color('#3f7a2e'), color('#9fd36a'), p.y).mul(mix(float(1), float(0.85), off.z));
  m.colorNode = tint.mul(world.light);
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return mesh;
}

/**
 * Wildflowers in small coloured clusters wherever the data texture says it's grassy, with a
 * soft glow after dark. One instanced mesh per colour so each can carry its own glow.
 */
export function buildFlowers(data: WorldData, preset: QualityPreset): THREE.Group {
  const g = new THREE.Group();
  g.name = 'flowers';
  const rng = mulberry32(hashString('flowers'));
  const palette = ['#d7263d', '#ffd23f', '#f4f0e6', '#c75b9b'];
  const spots: THREE.Vector3[][] = palette.map(() => []);
  const { minX, maxX, minZ, maxZ } = DATA_BOUNDS;
  for (let i = 0; i < 1400; i++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ - 60);
    const s = data.sample(x, z);
    if (s.grass < 0.7 || s.path > 0.1) continue;
    const c = Math.floor(rng() * palette.length);
    for (let k = 0; k < 5; k++) spots[c].push(new THREE.Vector3(x + (rng() - 0.5) * 1.2, s.height, z + (rng() - 0.5) * 1.2));
  }
  const m4 = new THREE.Matrix4();
  palette.forEach((hex, c) => {
    const list = spots[c];
    if (!list.length) return;
    const mat = new MeshLambertNodeMaterial({ color: hex });
    if (preset.glow) mat.emissiveNode = color(hex).mul(world.night.mul(0.9));
    const geo = new THREE.IcosahedronGeometry(0.09, 0);
    geo.translate(0, 0.28, 0);
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 4);
    stemGeo.translate(0, 0.14, 0);
    const heads = new THREE.InstancedMesh(geo, mat, list.length);
    const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshLambertMaterial({ color: '#4f8a3a' }), list.length);
    list.forEach((p, i) => {
      const s = 0.8 + ((i * 37) % 10) / 20;
      m4.makeScale(s, s, s).setPosition(p);
      heads.setMatrixAt(i, m4);
      stems.setMatrixAt(i, m4);
    });
    heads.computeBoundingSphere();
    stems.computeBoundingSphere();
    g.add(heads, stems);
  });
  return g;
}

/** A lamp bulb that lights up at dusk: put one on every lantern and streetlight. */
const bulbMats = new Map<string, MeshBasicNodeMaterial>();
export function glowBulb(hex = '#ffe9a3', radius = 0.18): THREE.Mesh {
  // One material per colour, so all the bulbs of a colour batch into one draw.
  let m = bulbMats.get(hex);
  if (!m) {
    m = new MeshBasicNodeMaterial();
    m.colorNode = mix(color('#8a8070'), color(hex).mul(1.6), world.night);
    bulbMats.set(hex, m);
  }
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), m);
}

/**
 * The lighthouse at night: the lamp room lights up and two soft beams sweep round. Both fade
 * in with the night uniform, so by day it is just a white-and-red lighthouse.
 */
export function lighthouseLamp(): { lamp: THREE.Material; beam: THREE.Group } {
  const lamp = new MeshBasicNodeMaterial();
  lamp.colorNode = mix(color('#d9d2b8'), color('#fff3c4').mul(2.2), world.night);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  m.colorNode = color('#fff1c2');
  // Bright at the lamp, fading out along the beam; nothing by day.
  m.opacityNode = float(1).sub(uv().y).pow(1.8).mul(0.2).mul(world.night);
  const beam = new THREE.Group();
  for (const dir of [1, -1]) {
    const geo = new THREE.CylinderGeometry(4.5, 0.45, 46, 18, 1, true).translate(0, 23, 0).rotateZ((-Math.PI / 2) * dir);
    const cone = new THREE.Mesh(geo, m);
    cone.renderOrder = 5;
    cone.frustumCulled = false;
    beam.add(cone);
  }
  beam.userData.dynamic = true;
  return { lamp, beam };
}
