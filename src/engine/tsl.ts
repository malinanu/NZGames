import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { distance, float, fog, mix, normalize, positionLocal, positionWorld, smoothstep, uniform, vec2, vec3 } from 'three/tsl';

/**
 * Shared TSL uniforms and helpers. Every custom shader in the game reads the same time,
 * day/night and fog values from here, so lighting and fog stay consistent across materials.
 * TSL compiles to WGSL on WebGPU and to GLSL on the WebGL fallback.
 */
export const world = {
  /** Seconds since start (drives waves, ripples, wind). */
  time: uniform(0),
  /** Fog is measured from this point (the player, or the game being played), not the camera. */
  focal: uniform(new THREE.Vector3()),
  fogColor: uniform(new THREE.Color('#cdeeff')),
  fogNear: uniform(70),
  fogFar: uniform(300),
  /** 0 in daylight, 1 at full night: lamps and flowers glow with it. */
  night: uniform(0),
  /** Direction towards the sun (or the moon at night), normalised. */
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  skyTop: uniform(new THREE.Color('#4fb0ff')),
  skyHorizon: uniform(new THREE.Color('#d6f1ff')),
  sunColor: uniform(new THREE.Color('#fff4dc')),
  /** Overall light level (0..~1.3) for cheap unlit things like grass. */
  light: uniform(1),
};

/** 0 near the focal point, rising to 1 by fogFar, using ground distance only. */
export const focalFogFactor = () => smoothstep(world.fogNear, world.fogFar, distance(positionWorld.xz, vec2(world.focal.x, world.focal.z)));

/** Replaces the camera-depth fog with distance-from-the-player fog for every material. */
export function installFog(scene: THREE.Scene): void {
  (scene as unknown as { fogNode: unknown }).fogNode = fog(world.fogColor, focalFogFactor());
}

/** The sky dome: horizon-to-zenith gradient, a soft sun disc, and stars at night. */
export function skyMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  m.fog = false;
  const dir = normalize(positionLocal);
  const t = smoothstep(float(-0.05), float(0.5), dir.y);
  const base = mix(world.skyHorizon, world.skyTop, t);
  const sunDot = dir.dot(world.sunDir).max(0);
  const disc = smoothstep(float(0.9975), float(0.9992), sunDot);
  const halo = sunDot.pow(64).mul(0.35);
  // Stars: a sparse hash of the direction, faded in at night and above the horizon.
  const cell = dir.mul(220).floor();
  const h = cell.x.mul(12.9898).add(cell.y.mul(78.233)).add(cell.z.mul(37.719)).sin().mul(43758.5453).fract();
  const stars = smoothstep(float(0.9975), float(1), h).mul(world.night).mul(smoothstep(float(0.05), float(0.3), dir.y));
  m.colorNode = base.add(world.sunColor.mul(disc.add(halo)).mul(float(1).sub(world.night.mul(0.6)))).add(vec3(stars));
  return m;
}
