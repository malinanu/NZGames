import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, color, float, floor, fract, mix, mx_noise_float, positionGeometry, positionWorld, sin, smoothstep, texture, uv, vec3 } from 'three/tsl';
import { world } from '../engine/tsl';
import type { QualityPreset } from '../engine/quality';
import { worldUv } from './ground';
import type { WorldData } from './dataTexture';
import { SEA_LEVEL, STREAM_Z0, STREAM_Z1, streamHalf, streamSurface, streamX } from './terrain';

/**
 * Stylised water, done with shader tricks rather than simulation:
 *  - the sea is one big plane that follows the camera; its colour comes from the water-depth
 *    channel of the world data texture, so it is clear and turquoise in the shallows and deep
 *    blue further out, which also tints whatever is underneath (legs, jetty piles, rocks);
 *  - ripples roll in towards the shore: a repeating band driven by depth and time, nudged by
 *    noise keyed to each band's index so consecutive waves never line up the same;
 *  - floating things bob with a simple buoyancy: below the surface they are pushed up in
 *    proportion to how deep they are, with damping; far from the player they go to sleep.
 */

/** Height of the sea surface at a point (the same waves the shader draws). */
export function seaSurface(x: number, z: number, t: number): number {
  return SEA_LEVEL + Math.sin(x * 0.16 + t) * 0.1 + Math.sin(z * 0.31 - t * 1.5) * 0.08;
}

export function buildSea(data: WorldData, preset: QualityPreset): THREE.Mesh {
  const SIZE = 700;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  // Follow the focal point in whole grid steps so the wave pattern doesn't swim.
  const step = SIZE / 140;
  const fx = floor(world.focal.x.div(step)).mul(step);
  const fz = floor(world.focal.z.div(step)).mul(step).add(SIZE * 0.3);
  const px = positionGeometry.x.add(fx);
  const pz = positionGeometry.z.add(fz);
  const wave = sin(px.mul(0.16).add(world.time)).mul(0.1).add(sin(pz.mul(0.31).sub(world.time.mul(1.5))).mul(0.08));
  m.positionNode = vec3(px, wave.add(SEA_LEVEL), pz);

  const d = texture(data.data, worldUv(positionWorld.x, positionWorld.z));
  const depth = d.b.mul(4); // metres
  const shallow = color('#48d4c8');
  const deep = color('#0d6a98');
  let col = mix(shallow, deep, smoothstep(float(0.2), float(3.6), depth));
  if (preset.waterDetail) {
    // Ripples heading for the shore. Each band has an index; noise per index varies its shape.
    const phase = depth.mul(1.6).sub(world.time.mul(0.35));
    const index = floor(phase);
    const wobble = mx_noise_float(vec3(positionWorld.x.mul(0.04), index, 0)).mul(0.35);
    // A thin crest: rises over the back of the band, drops away just before the next one.
    const f = fract(phase.add(wobble));
    const band = smoothstep(float(0.88), float(0.95), f).mul(float(1).sub(smoothstep(float(0.97), float(1), f)));
    const near = float(1).sub(smoothstep(float(0.4), float(3.2), depth));
    col = mix(col, color('#ffffff'), band.mul(near).mul(0.45));
  }
  // The lapping edge right at the sand.
  const edge = float(1).sub(smoothstep(float(0.0), float(0.22), depth.add(sin(positionWorld.x.mul(0.3).add(world.time)).mul(0.05))));
  col = mix(col, color('#ffffff'), edge.mul(0.6));
  // Unlit, so follow the day/night light level like the grass does.
  m.colorNode = col.add(wave.mul(0.3)).mul(world.light);
  // Clear in the shallows (you see the sand through it), solid when deep, nothing on dry land.
  m.opacityNode = smoothstep(float(0.0), float(0.04), depth).mul(mix(float(0.55), float(1), smoothstep(float(0.1), float(2.2), depth)));
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'sea';
  return mesh;
}

/** The stream: a ribbon down the channel, darker in the middle, foam where it laps the banks. */
export function buildStream(): THREE.Mesh {
  const n = (STREAM_Z1 - STREAM_Z0) * 2;
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = STREAM_Z0 + ((STREAM_Z1 - STREAM_Z0) * i) / n;
    const x = streamX(z);
    const half = streamHalf(z) + 0.8;
    const y = streamSurface(z);
    verts.push(x - half, y, z, x + half, y, z);
    uvs.push(0, i / 12, 1, i / 12);
    if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const u = uv();
  const centre = float(1).sub(u.x.sub(0.5).abs().mul(2));
  const ripple = sin(u.y.sub(world.time.mul(0.4)).mul(9).add(sin(u.x.mul(7).add(u.y.mul(0.5))).mul(1.6))).mul(0.5).add(0.5);
  let col = mix(color('#5c9e94'), color('#296b80'), smoothstep(float(0), float(0.7), centre)).add(ripple.mul(0.06));
  const lap = smoothstep(float(0.08), float(0), centre.sub(0.12).sub(sin(u.y.mul(3).add(world.time)).mul(0.02)).abs());
  col = mix(col, color('#ebf5f2'), lap.mul(0.6));
  m.colorNode = col.mul(world.light);
  m.opacityNode = float(0.9);
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 1;
  mesh.name = 'stream';
  return mesh;
}

/** An expanding ring on the water around wading legs. Call `pulse()` while moving. */
export function buildRipples(): { object: THREE.Mesh; pulse(at: THREE.Vector3, y: number): void; update(dt: number): void } {
  const count = 6;
  const geo = new THREE.RingGeometry(0.85, 1, 32);
  geo.rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = geo.index;
  inst.setAttribute('position', geo.getAttribute('position'));
  const life = new Float32Array(count * 4);
  const attr = new THREE.InstancedBufferAttribute(life, 4); // x, y, z, age
  inst.setAttribute('aRing', attr);
  inst.instanceCount = count;
  const r = attribute('aRing', 'vec4');
  const scale = r.w.mul(1.6).add(0.2);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.positionNode = positionGeometry.mul(scale).add(vec3(r.x, r.y, r.z));
  m.colorNode = color('#ffffff');
  m.opacityNode = float(1).sub(r.w).mul(0.6).mul(smoothstep(float(0), float(0.05), r.w));
  const object = new THREE.Mesh(inst, m);
  object.frustumCulled = false;
  object.renderOrder = 2;
  let next = 0;
  for (let i = 0; i < count; i++) life[i * 4 + 3] = 1;
  return {
    object,
    pulse(at, y) {
      life.set([at.x, y + 0.02, at.z, 0], next * 4);
      next = (next + 1) % count;
      attr.needsUpdate = true;
    },
    update(dt) {
      for (let i = 0; i < count; i++) life[i * 4 + 3] = Math.min(1, life[i * 4 + 3] + dt * 0.9);
      attr.needsUpdate = true;
    },
  };
}

interface Floater {
  object: THREE.Object3D;
  vy: number;
  /** How much of its height sits under water when at rest (0..1 of `draft`). */
  draft: number;
  drift: THREE.Vector2;
  home: THREE.Vector3;
  tether: number;
  /** Radius for being nudged along by the player (0 = moored, can't be pushed). */
  push: number;
}

/**
 * Buoyancy for things on the water. Each floater has a draft (how deep it sits); below the
 * surface it gets an upward push proportional to depth, gravity pulls it back, damping stops
 * the bounce. A gentle current drifts it, tethered to where it started (moorings, the swell
 * just bringing it back). Floaters far from the player sleep.
 */
export class Buoyancy {
  private readonly items: Floater[] = [];

  add(object: THREE.Object3D, opts: { draft?: number; tether?: number; push?: number } = {}): void {
    this.items.push({ object, vy: 0, draft: opts.draft ?? 0.3, drift: new THREE.Vector2((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3), home: object.position.clone(), tether: opts.tether ?? 3, push: opts.push ?? 0 });
  }

  update(dt: number, t: number, focal: THREE.Vector3): void {
    for (const f of this.items) {
      const p = f.object.position;
      if (Math.hypot(p.x - focal.x, p.z - focal.z) > 90) continue; // asleep
      const surface = seaSurface(p.x, p.z, t);
      const submerged = surface - (p.y - f.draft);
      const g = 9.8;
      f.vy += (submerged > 0 ? Math.min(submerged / f.draft, 2) * g : 0) * dt - g * dt;
      f.vy *= Math.exp(-dt * 2.5);
      p.y += f.vy * dt;
      // Drift with a slow current, pulled back towards the mooring.
      p.x += (f.drift.x + (f.home.x - p.x) * 0.05) * dt;
      p.z += (f.drift.y + (f.home.z - p.z) * 0.05) * dt;
      if (Math.hypot(p.x - f.home.x, p.z - f.home.z) > f.tether) f.drift.multiplyScalar(-1);
      // Swim or wade into it and it bobs away from you (the swell slowly brings it back).
      if (f.push > 0) {
        const dx = p.x - focal.x;
        const dz = p.z - focal.z;
        const d = Math.hypot(dx, dz);
        const reach = f.push + 0.4;
        if (d < reach && d > 1e-3) {
          p.x += (dx / d) * (reach - d);
          p.z += (dz / d) * (reach - d);
          f.object.rotation.y += (reach - d) * 2;
          f.vy -= 0.6;
        }
      }
      // Rock with the swell.
      const slopeX = seaSurface(p.x + 0.5, p.z, t) - seaSurface(p.x - 0.5, p.z, t);
      const slopeZ = seaSurface(p.x, p.z + 0.5, t) - seaSurface(p.x, p.z - 0.5, t);
      f.object.rotation.x = THREE.MathUtils.lerp(f.object.rotation.x, slopeZ * 0.8, Math.min(1, dt * 3));
      f.object.rotation.z = THREE.MathUtils.lerp(f.object.rotation.z, -slopeX * 0.8, Math.min(1, dt * 3));
    }
  }
}
