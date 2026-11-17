import * as THREE from 'three';
import { world } from '../engine/tsl';

/**
 * Day → Dusk → Night → Dawn. One progress value (0..1) runs the whole cycle; every lighting
 * value is a keyframe on that value and is blended between the two nearest presets.
 *
 * The sun travels a full circle but always stays in the northern half of the sky (where it
 * is in Aotearoa), so the usual camera, which looks roughly north, never has the light
 * directly behind it and the world keeps its shading. It sits high at midday and drops low
 * for long shadows at dusk and dawn; at night the same light becomes a dim, cool moon.
 */
interface Preset {
  at: number;
  skyTop: string;
  skyHorizon: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** 0..1: how strongly lamps and flowers glow. */
  glow: number;
  /** Sun elevation above the horizon, degrees. */
  elevation: number;
}

const PRESETS: Preset[] = [
  { at: 0.0, skyTop: '#4fb0ff', skyHorizon: '#d6f1ff', fog: '#cdeeff', fogNear: 80, fogFar: 320, sun: '#fff4dc', sunIntensity: 2.4, hemiSky: '#eaf7ff', hemiGround: '#6e9a52', hemiIntensity: 1.25, glow: 0, elevation: 62 },
  { at: 0.42, skyTop: '#6a9be8', skyHorizon: '#ffc79a', fog: '#ffd2b0', fogNear: 70, fogFar: 280, sun: '#ffb070', sunIntensity: 1.9, hemiSky: '#ffd9c0', hemiGround: '#6a7a52', hemiIntensity: 0.95, glow: 0.35, elevation: 14 },
  { at: 0.6, skyTop: '#0b1640', skyHorizon: '#2a3a72', fog: '#1d2a5a', fogNear: 45, fogFar: 210, sun: '#9fb6ff', sunIntensity: 0.45, hemiSky: '#6f8fe0', hemiGround: '#20283a', hemiIntensity: 0.5, glow: 1, elevation: 40 },
  { at: 0.8, skyTop: '#5b86d6', skyHorizon: '#ffd8c2', fog: '#f4dccf', fogNear: 60, fogFar: 260, sun: '#ffc2a0', sunIntensity: 1.6, hemiSky: '#f6e0d6', hemiGround: '#5f7a52', hemiIntensity: 0.85, glow: 0.4, elevation: 12 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function blend(a: Preset, b: Preset, t: number, key: keyof Preset, out: THREE.Color): THREE.Color {
  return out.copy(tmpA.set(a[key] as string)).lerp(tmpB.set(b[key] as string), t);
}

export class DayCycle {
  /** 0..1 position in the cycle. */
  progress: number;
  /** Seconds for a full cycle (daytime takes most of it). */
  length = 600;
  /** When set (0..1 night), a game holds the cycle at night/day; null lets it run. */
  forcedNight: number | null = null;
  private forced = 0;
  readonly sunOffset = new THREE.Vector3();

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
    start = 0.08,
  ) {
    this.progress = start;
  }

  /** Name of where we are in the cycle, for tests and the debug readout. */
  get phase(): string {
    const p = this.progress;
    return p < 0.35 ? 'Day' : p < 0.52 ? 'Dusk' : p < 0.72 ? 'Night' : p < 0.9 ? 'Dawn' : 'Day';
  }

  update(dt: number): void {
    this.progress = (this.progress + dt / this.length) % 1;
    this.forced += ((this.forcedNight ?? 0) - this.forced) * Math.min(1, dt * 3);

    // Find the two presets either side of the current progress (the list wraps round).
    const p = this.progress;
    let i = PRESETS.length - 1;
    for (let k = 0; k < PRESETS.length; k++) if (PRESETS[k].at <= p) i = k;
    const a = PRESETS[i];
    const b = PRESETS[(i + 1) % PRESETS.length];
    const span = ((b.at - a.at + 1) % 1) || 1;
    const t = THREE.MathUtils.smoothstep(((p - a.at + 1) % 1) / span, 0, 1);
    const night = PRESETS[2];
    const f = this.forced;
    const mixNight = (c: THREE.Color, key: keyof Preset) => c.lerp(tmpB.set(night[key] as string), f);
    const num = (key: keyof Preset) => THREE.MathUtils.lerp(THREE.MathUtils.lerp(a[key] as number, b[key] as number, t), night[key] as number, f);

    mixNight(blend(a, b, t, 'skyTop', world.skyTop.value as THREE.Color), 'skyTop');
    mixNight(blend(a, b, t, 'skyHorizon', world.skyHorizon.value as THREE.Color), 'skyHorizon');
    mixNight(blend(a, b, t, 'fog', world.fogColor.value as THREE.Color), 'fog');
    mixNight(blend(a, b, t, 'sun', this.sun.color), 'sun');
    (world.sunColor.value as THREE.Color).copy(this.sun.color);
    mixNight(blend(a, b, t, 'hemiSky', this.hemi.color), 'hemiSky');
    mixNight(blend(a, b, t, 'hemiGround', this.hemi.groundColor), 'hemiGround');
    world.fogNear.value = num('fogNear');
    world.fogFar.value = num('fogFar');
    this.sun.intensity = num('sunIntensity');
    this.hemi.intensity = num('hemiIntensity');
    world.night.value = num('glow');
    world.light.value = this.hemi.intensity * 0.55 + this.sun.intensity * 0.22;

    // The sun's circle: azimuth sweeps right round the north side through the day; at
    // night the light is the moon, on the same side of the sky.
    const elevation = THREE.MathUtils.degToRad(num('elevation'));
    const azimuth = Math.PI * (0.25 + p * 0.5) + Math.PI / 2; // from north-east round to north-west
    const dir = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.abs(Math.sin(azimuth)) * Math.cos(elevation) - 0.35).normalize();
    this.sunOffset.copy(dir).multiplyScalar(80);
    (world.sunDir.value as THREE.Vector3).copy(dir);
  }
}
