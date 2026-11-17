import * as THREE from 'three';
import { CHARACTERS, createCharacter, type Character } from '../character/character';
import type { ZoneContext } from './types';

/**
 * Small shared pieces for game zones: camera framing, pointer input, timers, confetti,
 * saved bests and helper characters. Everything takes local (zone) coordinates.
 */

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Points the camera from `from` at `to`, both in zone space. Shots are framed on a 420x800
 * portrait phone; with `fit` (the default) the rig backs the camera off along (from - to) on
 * screens that would crop that framing (`CameraRig.shotScale`). Pass `fit = false` when the
 * distance already comes from `fitDistance`, which accounts for the screen itself.
 */
export function frame(ctx: ZoneContext, from: THREE.Vector3, to: THREE.Vector3, sharpness = 3.2, fit = true): void {
  ctx.root.updateMatrixWorld(true);
  ctx.rig.shot(ctx.root.localToWorld(from.clone()), ctx.root.localToWorld(to.clone()), sharpness, fit);
}

/** Distance needed for a portrait/landscape-safe framing of something `w` wide and `h` tall. */
export function fitDistance(ctx: ZoneContext, w: number, h: number): number {
  const vHalf = THREE.MathUtils.degToRad(ctx.camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * ctx.camera.aspect);
  return Math.max(w / 2 / Math.tan(hHalf), h / 2 / Math.tan(vHalf));
}

export interface PointerInfo {
  x: number;
  y: number;
  /** Where the pointer hits a horizontal plane at `planeY` (zone space), if it does. */
  ground: THREE.Vector3 | null;
}

/**
 * Pointer handling bound to the canvas while a game runs. `tap` fires for short presses,
 * `drag` reports start, move and end. Call `release()` in stop().
 */
export function pointer(
  ctx: ZoneContext,
  handlers: {
    planeY?: number;
    tap?: (p: PointerInfo) => void;
    down?: (p: PointerInfo) => void;
    move?: (p: PointerInfo, start: PointerInfo) => void;
    up?: (p: PointerInfo, start: PointerInfo, tapped: boolean) => void;
  },
): { release(): void; hit(x: number, y: number): PointerInfo } {
  const ray = new THREE.Raycaster();
  const hit = (x: number, y: number): PointerInfo => {
    ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), ctx.camera);
    ctx.root.updateMatrixWorld(true);
    const inv = ctx.root.matrixWorld.clone().invert();
    const local = ray.ray.clone().applyMatrix4(inv);
    const g = local.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(handlers.planeY ?? 0)), new THREE.Vector3());
    return { x, y, ground: g };
  };
  let start: PointerInfo | null = null;
  let id = -1;
  const onDown = (e: PointerEvent) => {
    if (start) return;
    id = e.pointerId;
    start = hit(e.clientX, e.clientY);
    ctx.canvas.setPointerCapture(e.pointerId);
    handlers.down?.(start);
  };
  const onMove = (e: PointerEvent) => {
    if (!start || e.pointerId !== id) return;
    handlers.move?.(hit(e.clientX, e.clientY), start);
  };
  const onUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== id) return;
    const p = hit(e.clientX, e.clientY);
    const tapped = Math.hypot(p.x - start.x, p.y - start.y) < 12;
    const s = start;
    start = null;
    handlers.up?.(p, s, tapped);
    if (tapped) handlers.tap?.(p);
  };
  const onCancel = () => (start = null);
  ctx.canvas.addEventListener('pointerdown', onDown);
  ctx.canvas.addEventListener('pointermove', onMove);
  ctx.canvas.addEventListener('pointerup', onUp);
  ctx.canvas.addEventListener('pointercancel', onCancel);
  return {
    hit,
    release() {
      ctx.canvas.removeEventListener('pointerdown', onDown);
      ctx.canvas.removeEventListener('pointermove', onMove);
      ctx.canvas.removeEventListener('pointerup', onUp);
      ctx.canvas.removeEventListener('pointercancel', onCancel);
      start = null;
    },
  };
}

/** Screen position of a zone-space point (for tests and floating labels). */
export function toScreen(ctx: ZoneContext, local: THREE.Vector3): { x: number; y: number } {
  ctx.root.updateMatrixWorld(true);
  const p = ctx.root.localToWorld(local.clone()).project(ctx.camera);
  return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
}

/** Keeps the best score per game and seed in local storage; returns the best so far. */
export function best(game: string, seed: string, score: number, higherIsBetter = true): number {
  const key = `kiwi-christmas:best:${game}:${seed}`;
  try {
    const prev = Number(localStorage.getItem(key) ?? NaN);
    const b = Number.isNaN(prev) ? score : higherIsBetter ? Math.max(prev, score) : Math.min(prev, score);
    localStorage.setItem(key, String(b));
    return b;
  } catch {
    return score;
  }
}

const CONFETTI_COLOURS = ['#ff4fa3', '#9be22d', '#27c4f5', '#ffd23f', '#8b5cf6', '#ff7a1a'];

/**
 * A burst of confetti (or water spray, with `colours`). Add `.object` to the scene, tick
 * `update`. Pieces are tiny instanced cubes rather than GL points: point sprites have no size
 * in WebGPU, and tumbling flakes look better anyway.
 */
export function burst(count = 80, colours = CONFETTI_COLOURS, size = 0.13) {
  const geo = new THREE.BoxGeometry(size * 0.7, size * 0.15, size * 0.5);
  const mat = new THREE.MeshBasicMaterial({ transparent: true });
  const object = new THREE.InstancedMesh(geo, mat, count);
  object.frustumCulled = false;
  object.visible = false;
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const spin = new Float32Array(count);
  let life = 0;
  let floor = 0;
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 1, 0).normalize();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    object,
    fire(at: THREE.Vector3, power = 1) {
      floor = at.y - 0.2;
      for (let i = 0; i < count; i++) {
        pos.set([at.x, at.y + 0.1, at.z], i * 3);
        const a = Math.random() * Math.PI * 2;
        const s = (1 + Math.random() * 2.5) * power;
        vel.set([Math.cos(a) * s, (3 + Math.random() * 3.5) * power, Math.sin(a) * s], i * 3);
        spin[i] = Math.random() * 12;
        object.setColorAt(i, c.set(colours[i % colours.length]));
      }
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
      life = 1.6;
      object.visible = true;
    },
    update(dt: number) {
      if (life <= 0) return;
      life -= dt;
      for (let i = 0; i < count; i++) {
        vel[i * 3 + 1] -= 9 * dt;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
        if (pos[i * 3 + 1] < floor) pos[i * 3 + 1] = floor;
        q.setFromAxisAngle(axis, spin[i] * (1.6 - life));
        m.compose(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), q, one);
        object.setMatrixAt(i, m);
      }
      object.instanceMatrix.needsUpdate = true;
      mat.opacity = Math.min(1, life * 2);
      if (life <= 0) object.visible = false;
    },
  };
}

/** A helper character for a game (bowler, neighbour, customer...). Never the player's own. */
export async function helper(ctx: ZoneContext, offset: number): Promise<Character> {
  const mine = CHARACTERS.findIndex((c) => c.id === ctx.player.character.def.id);
  const def = CHARACTERS[(mine + 1 + offset) % CHARACTERS.length];
  const c = await createCharacter(def);
  ctx.root.add(c.root);
  // The zone manager ticks every helper's animation (zones don't have to remember to).
  ((ctx.root.userData.characters ??= []) as Character[]).push(c);
  return c;
}

/** Plain material shortcuts for procedural game pieces. */
const mats = new Map<string, THREE.MeshLambertMaterial>();
export function mat(colour: string): THREE.MeshLambertMaterial {
  let m = mats.get(colour);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: colour });
    mats.set(colour, m);
  }
  return m;
}

export function mesh(geo: THREE.BufferGeometry, colour: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(colour));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Simple countdown shown as a stat. */
export class Countdown {
  left: number;
  constructor(readonly total: number) {
    this.left = total;
  }
  tick(dt: number): boolean {
    this.left = Math.max(0, this.left - dt);
    return this.left <= 0;
  }
  get label(): string {
    const s = Math.ceil(this.left);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}

/** Frees GPU memory for everything under `root` (geometries only; materials are shared). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

// -- Keyboard and gamepad helpers -------------------------------------------------------------

const PAD_GLYPHS: Record<'xbox' | 'playstation', Record<string, string>> = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Start: '☰' },
  playstation: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', Start: 'Options' },
};

/**
 * An input-aware hint: one line per device, shown by `html[data-input]`. In `keyboard` and
 * `pad`, `{Name}` becomes a key cap: pad names are A, B, X, Y, LB, RB, LT, RT and Start (shown
 * as Xbox or PlayStation glyphs); keyboard names are printed as given ({Space}, {Enter}, {Q}).
 */
export function controls(lines: { touch: string; keyboard: string; pad: string }): string {
  const cap = (s: string, table?: Record<string, string>) => s.replace(/\{([^}]+)\}/g, (_, k: string) => `<b class="key">${table?.[k] ?? k}</b>`);
  return [
    `<span data-for="touch">${lines.touch}</span>`,
    `<span data-for="keyboard">${cap(lines.keyboard)}</span>`,
    `<span data-for="xbox">${cap(lines.pad, PAD_GLYPHS.xbox)}</span>`,
    `<span data-for="playstation">${cap(lines.pad, PAD_GLYPHS.playstation)}</span>`,
  ].join('');
}

/** True when the player is on keyboard or gamepad (so cursors and highlights should show). */
export const usingButtons = (ctx: ZoneContext) => ctx.input.device() !== 'touch';

/**
 * Spatial navigation for pick-and-place games: from point `from`, the nearest of `points` in
 * screen direction `dir` (x right, y up). Returns the index, or `current` if nothing lies that
 * way. Points are in zone space and are projected through the camera, so "up" is what the
 * player sees as up.
 */
export function step(ctx: ZoneContext, points: THREE.Vector3[], current: number, dir: { x: number; y: number }): number {
  if (!dir.x && !dir.y) return current;
  const at = points.map((p) => toScreen(ctx, p));
  const from = at[current] ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const len = Math.hypot(dir.x, dir.y);
  const dx = dir.x / len;
  const dy = -dir.y / len;
  let bestI = current;
  let bestScore = Infinity;
  at.forEach((p, i) => {
    if (i === current) return;
    const vx = p.x - from.x;
    const vy = p.y - from.y;
    const along = vx * dx + vy * dy;
    if (along < 8) return;
    const across = Math.abs(vx * dy - vy * dx);
    if (across > along * 1.8) return;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      bestI = i;
    }
  });
  return bestI;
}

/** A pulsing ring that marks the keyboard/gamepad cursor on the ground. Add `.object` to the zone. */
export function cursorRing(radius = 0.5, colour = '#ffd23f') {
  const object = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.025, radius * 0.07), 8, 40),
    new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true }),
  );
  object.rotation.x = Math.PI / 2;
  object.renderOrder = 10;
  object.visible = false;
  return {
    object,
    /** Shows the ring at `at` (zone space) if `show`, pulsing with time. */
    update(show: boolean, at: THREE.Vector3 | null, elapsed: number) {
      object.visible = show && !!at;
      if (!object.visible || !at) return;
      object.position.copy(at);
      object.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.08);
    },
  };
}

/**
 * Marks button `index` in a list of sheet buttons as the keyboard/gamepad cursor (outlined
 * only when not on touch, see world.css) and scrolls it into view.
 */
export function markCursor(buttons: Iterable<Element>, index: number): void {
  let i = 0;
  for (const b of buttons) {
    const on = i++ === index;
    b.classList.toggle('pad-cursor', on);
    if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * Aim and power for flick and lob games on keyboard or gamepad: the stick (or arrows) moves
 * the aim left and right and the power up and down; both stay where they are left, so the
 * player can line up and then fire with A / Space.
 */
export function padAim(opts: { yawMax: number; yawSpeed?: number; powerSpeed?: number }) {
  const state = {
    power: 0.5,
    yaw: 0,
    /** Set once the player has touched the aim this turn (show the preview arc). */
    active: false,
    reset(power = 0.5, yaw = 0) {
      state.power = power;
      state.yaw = yaw;
      state.active = false;
    },
    /** Applies the stick for one frame. Returns true if the aim changed. */
    update(ctx: ZoneContext, dt: number): boolean {
      const s = ctx.input.stick();
      if (!s.x && !s.y) return false;
      state.active = true;
      state.yaw = THREE.MathUtils.clamp(state.yaw + s.x * dt * (opts.yawSpeed ?? 0.7), -opts.yawMax, opts.yawMax);
      state.power = THREE.MathUtils.clamp(state.power + s.y * dt * (opts.powerSpeed ?? 0.45), 0, 1);
      return true;
    },
  };
  return state;
}
