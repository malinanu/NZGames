import * as THREE from 'three';

/**
 * All walking input, normalised: keyboard, touch and gamepads end up as the same `move`,
 * `run`, jump, interact, turn and zoom.
 *
 *  - Touch (one finger): the ground ring around your character. Drag from the character in
 *    the direction you want to go; the further out, the faster, and past the outer ring you
 *    run. Tap the character to jump.
 *  - Touch (two fingers): pinch to zoom, slide sideways to turn the camera.
 *  - Mouse: drag to turn the camera, wheel to zoom. Keyboard: WASD/arrows, Shift walks,
 *    Space jumps, E plays, Q/R turn.
 *  - Gamepad: standard, Xbox and PlayStation layouts, including Firefox's non-standard
 *    mappings (see `readPad`).
 *
 * The last device used is tracked so prompts can show the right glyphs (`Glyphs`).
 * Zones switch this off and handle their own pointer input on the canvas; their keyboard and
 * gamepad input goes through `ZoneInput` (src/world/zoneInput.ts), which reads `pad` from here.
 */

export type Device = 'keyboard' | 'touch' | 'xbox' | 'playstation';

/** Where the player is on screen, and the ground ring's radius there, in CSS pixels. */
export interface Anchor {
  x: number;
  y: number;
  r: number;
}

/** A gamepad's state in one layout, whatever the browser or controller reported. */
export interface Pad {
  kind: 'xbox' | 'playstation';
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Analogue triggers, 0..1. */
  lt: number;
  rt: number;
  south: boolean;
  east: boolean;
  west: boolean;
  north: boolean;
  lb: boolean;
  rb: boolean;
  start: boolean;
  select: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const DEAD = 0.18;

/** Radial dead zone, rescaled so the stick still reaches 1 at full tilt. */
function deadzone(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len < DEAD) return [0, 0];
  const k = Math.min(1, (len - DEAD) / (1 - DEAD)) / len;
  return [x * k, y * k];
}

/**
 * Some browsers (Firefox on Linux in particular) report triggers as axes running -1..1 that
 * read 0 until first touched, which would look like a half-pulled trigger. An axis only counts
 * once it has moved away from 0.
 */
const touchedAxes = new Set<string>();
function triggerAxis(pad: Gamepad, i: number): number {
  const v = pad.axes[i] ?? -1;
  const key = `${pad.index}:${i}`;
  if (!touchedAxes.has(key)) {
    if (v === 0) return 0;
    touchedAxes.add(key);
  }
  return THREE.MathUtils.clamp((v + 1) / 2, 0, 1);
}

export function padKind(id: string): 'xbox' | 'playstation' {
  // Sony pads report vendor 054c, or are just called "Wireless Controller" (DualShock 4);
  // Xbox names contain "Wireless Controller" too, so check for Xbox first.
  if (/xbox|045e|xinput/i.test(id)) return 'xbox';
  return /054c|playstation|dualshock|dualsense|wireless controller/i.test(id) ? 'playstation' : 'xbox';
}

/** Reads one gamepad into the common layout. */
export function readPad(pad: Gamepad): Pad {
  const kind = padKind(pad.id);
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  const v = (i: number) => pad.buttons[i]?.value ?? 0;
  let lx = pad.axes[0] ?? 0;
  let ly = pad.axes[1] ?? 0;
  let rx: number;
  let ry: number;
  let lt: number;
  let rt: number;
  let s: Omit<Pad, 'kind' | 'lx' | 'ly' | 'rx' | 'ry' | 'lt' | 'rt'>;
  if (pad.mapping === 'standard') {
    rx = pad.axes[2] ?? 0;
    ry = pad.axes[3] ?? 0;
    lt = v(6);
    rt = v(7);
    s = { south: b(0), east: b(1), west: b(2), north: b(3), lb: b(4), rb: b(5), select: b(8), start: b(9), up: b(12), down: b(13), left: b(14), right: b(15) };
  } else if (pad.axes.length >= 6) {
    // Linux evdev order (Firefox): left stick, left trigger, right stick, right trigger, d-pad.
    rx = pad.axes[3] ?? 0;
    ry = pad.axes[4] ?? 0;
    lt = triggerAxis(pad, 2);
    rt = triggerAxis(pad, 5);
    const dx = pad.axes[6] ?? 0;
    const dy = pad.axes[7] ?? 0;
    const dpad = { up: dy < -0.5, down: dy > 0.5, left: dx < -0.5, right: dx > 0.5 };
    s = kind === 'playstation'
      ? { south: b(0), east: b(1), north: b(2), west: b(3), lb: b(4), rb: b(5), select: b(8), start: b(9), ...dpad }
      : { south: b(0), east: b(1), west: b(2), north: b(3), lb: b(4), rb: b(5), select: b(6), start: b(7), ...dpad };
  } else {
    rx = pad.axes[2] ?? 0;
    ry = pad.axes[3] ?? 0;
    lt = v(6);
    rt = v(7);
    s = { south: b(0), east: b(1), west: b(2), north: b(3), lb: b(4), rb: b(5), select: b(8), start: b(9), up: b(12), down: b(13), left: b(14), right: b(15) };
  }
  [lx, ly] = deadzone(lx, ly);
  [rx, ry] = deadzone(rx, ry);
  return { kind, lx, ly, rx, ry, lt, rt, ...s };
}

interface Touch {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
}

export class Input {
  /** x = strafe right, y = forward. Length 0..1. */
  readonly move = new THREE.Vector2();
  run = false;
  /** The device used last (drives prompt glyphs). */
  device: Device;
  /** The latest gamepad state, or null without one. */
  pad: Pad | null = null;
  /** Touch walking, for the ground ring: is a finger down, and the screen-space push. */
  readonly ring = { active: false, x: 0, y: 0, amount: 0, run: false };
  /** Supplied by the world: where the player is on screen. */
  anchor: (() => Anchor | null) | null = null;

  private turn = 0;
  private zoom = 0;
  private jumpQueued = false;
  private interactQueued = false;
  private menuQueued = false;
  private enabledFlag = true;
  private readonly keys = new Set<string>();
  private readonly touches = new Map<number, Touch>();
  private walker: number | null = null;
  private pinch = 0;
  private pinchMid = 0;
  private mouse: number | null = null;
  private mouseX = 0;
  private prevButtons: Partial<Pad> = {};
  private readonly listeners = new Set<(d: Device) => void>();

  constructor(private readonly surface: HTMLElement) {
    this.device = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      // Track the device even inside zones (which switch walking off), so their hints match.
      this.use('keyboard');
      if (!this.enabledFlag || e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.interactQueued = true;
      if (e.code === 'KeyM') this.menuQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => this.use(padKind((e as GamepadEvent).gamepad.id)));

    // Zones handle their own pointers, but the device still has to follow them for the hints.
    window.addEventListener('pointerdown', (e) => this.use(e.pointerType === 'mouse' ? 'keyboard' : 'touch'), { capture: true });
    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.moveTo(e));
    surface.addEventListener('pointerup', (e) => this.up(e));
    surface.addEventListener('pointercancel', (e) => this.up(e, true));
    surface.addEventListener('wheel', (e) => {
      if (!this.enabledFlag) return;
      this.zoom += Math.sign(e.deltaY) * 0.08;
    }, { passive: true });
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  set enabled(v: boolean) {
    this.enabledFlag = v;
    if (!v) {
      this.keys.clear();
      this.touches.clear();
      this.walker = null;
      this.mouse = null;
      this.ring.active = false;
      this.move.set(0, 0);
    }
  }

  /** Called whenever the device in use changes (and once now). */
  onDevice(fn: (d: Device) => void): void {
    this.listeners.add(fn);
    fn(this.device);
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  consumeInteract(): boolean {
    const j = this.interactQueued;
    this.interactQueued = false;
    return j;
  }

  consumeMenu(): boolean {
    const j = this.menuQueued;
    this.menuQueued = false;
    return j;
  }

  queueInteract(): void {
    this.interactQueued = true;
  }

  consumeTurn(): number {
    let t = this.turn;
    this.turn = 0;
    if (this.keys.has('KeyQ')) t += 0.035;
    if (this.keys.has('KeyR')) t -= 0.035;
    return t;
  }

  /** Zoom requested since the last read: positive pulls out, negative moves in. */
  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  /** Call once per frame before reading `move`. */
  update(): void {
    this.pollPad();
    if (!this.enabledFlag) return;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const pad = this.pad;
    if (x !== 0 || y !== 0) {
      this.move.set(x, y).normalize();
      this.run = !(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    } else if (pad && (pad.lx || pad.ly)) {
      this.move.set(pad.lx, -pad.ly);
      if (this.move.lengthSq() > 1) this.move.normalize();
      // Full tilt or a squeezed trigger runs.
      this.run = this.move.length() > 0.85 || pad.rt > 0.3;
    } else if (this.walker !== null && this.ring.active) {
      this.move.set(this.ring.x, this.ring.y).multiplyScalar(this.ring.amount);
      this.run = this.ring.run;
    } else {
      this.move.set(0, 0);
      this.run = false;
    }
    if (pad) {
      this.turn -= pad.rx * 0.045;
      this.zoom += pad.ry * 0.02;
    }
  }

  private capture(id: number): void {
    try {
      this.surface.setPointerCapture?.(id);
    } catch {
      // The pointer already ended (or was synthetic); capture isn't essential.
    }
  }

  private use(d: Device): void {
    if (d === this.device) return;
    this.device = d;
    for (const fn of this.listeners) fn(d);
  }

  private pollPad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let found: Pad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        found = readPad(p);
        break;
      }
    }
    this.pad = found;
    if (!found) return;
    const pressed = (k: keyof Pad) => !!found![k] && !this.prevButtons[k];
    const active = found.lx || found.ly || found.rx || found.ry || found.lt > 0.3 || found.rt > 0.3 ||
      (['south', 'east', 'west', 'north', 'lb', 'rb', 'start', 'select', 'up', 'down', 'left', 'right'] as const).some((k) => found![k]);
    if (active) this.use(found.kind);
    // Inside games (walking disabled) the buttons belong to the game (ZoneInput).
    if (this.enabledFlag) {
      if (pressed('south')) this.jumpQueued = true;
      if (pressed('east')) this.interactQueued = true;
      if (pressed('start')) this.menuQueued = true;
      if (pressed('rb') || pressed('lb')) this.zoom += pressed('rb') ? 0.25 : -0.25;
    }
    this.prevButtons = found;
  }

  private down(e: PointerEvent): void {
    if (!this.enabledFlag) return;
    if (e.pointerType === 'mouse') {
      this.use('keyboard');
      if (e.button !== 0) return;
      this.mouse = e.pointerId;
      this.mouseX = e.clientX;
      this.capture(e.pointerId);
      return;
    }
    this.use('touch');
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.capture(e.pointerId);
    if (this.touches.size === 1) {
      this.walker = e.pointerId;
      this.updateRing();
    } else {
      // A second finger turns walking into camera control.
      this.walker = null;
      this.ring.active = false;
      this.startPinch();
    }
  }

  private moveTo(e: PointerEvent): void {
    if (e.pointerId === this.mouse) {
      this.turn -= (e.clientX - this.mouseX) * 0.006;
      this.mouseX = e.clientX;
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touches.size >= 2) this.updatePinch();
    else if (e.pointerId === this.walker) this.updateRing();
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (e.pointerId === this.mouse) {
      this.mouse = null;
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    if (e.pointerId === this.walker) {
      // A quick tap on your character jumps.
      const a = this.anchor?.();
      const still = Math.hypot(t.x - t.sx, t.y - t.sy) < 14 && performance.now() - t.t < 300;
      if (!cancelled && still && a && Math.hypot(t.sx - a.x, t.sy - a.y) < Math.max(36, a.r * 0.45)) this.jumpQueued = true;
      this.walker = null;
      this.ring.active = false;
    }
    if (this.touches.size >= 2) this.startPinch();
  }

  /** One finger: direction and distance from the character set the walk. */
  private updateRing(): void {
    const t = this.walker !== null ? this.touches.get(this.walker) : null;
    const a = this.anchor?.();
    if (!t || !a) return;
    // Until the finger moves a little, a press could still be a tap: don't walk yet.
    if (Math.hypot(t.x - t.sx, t.y - t.sy) < 10) {
      this.ring.active = false;
      return;
    }
    const dx = t.x - a.x;
    const dy = t.y - a.y;
    const n = Math.hypot(dx, dy) / Math.max(a.r, 40);
    this.ring.active = true;
    this.ring.x = dx / Math.max(1e-3, Math.hypot(dx, dy));
    this.ring.y = -dy / Math.max(1e-3, Math.hypot(dx, dy));
    // Inside the inner circle you stand still; the walk builds towards the outer ring.
    this.ring.amount = THREE.MathUtils.clamp((n - 0.3) / 0.7, 0, 1);
    this.ring.run = n > 1.1;
  }

  private pair(): [Touch, Touch] | null {
    const [a, b] = [...this.touches.values()];
    return a && b ? [a, b] : null;
  }

  private startPinch(): void {
    const p = this.pair();
    if (!p) return;
    this.pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    this.pinchMid = (p[0].x + p[1].x) / 2;
  }

  /** Two fingers: spread or pinch to zoom, slide sideways to turn. */
  private updatePinch(): void {
    const p = this.pair();
    if (!p) return;
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const mid = (p[0].x + p[1].x) / 2;
    if (this.pinch > 0) this.zoom += Math.log(this.pinch / Math.max(d, 1)) * 1.2;
    this.turn -= (mid - this.pinchMid) * 0.008;
    this.pinch = d;
    this.pinchMid = mid;
  }
}

/** The glyph to show for an action on the current device. */
export function glyph(action: 'interact' | 'jump' | 'map', device: Device): string {
  const table: Record<Device, Record<typeof action, string>> = {
    keyboard: { interact: 'E', jump: 'Space', map: 'M' },
    xbox: { interact: 'B', jump: 'A', map: '☰' },
    playstation: { interact: '○', jump: '✕', map: 'Options' },
    touch: { interact: '', jump: '', map: '' },
  };
  return table[device][action];
}
