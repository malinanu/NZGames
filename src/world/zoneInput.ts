import type { Device, Input, Pad } from '../engine/input';
import type { PadButton, ZoneInput } from '../zones/types';

const BUTTONS: PadButton[] = ['south', 'east', 'west', 'north', 'lb', 'rb', 'start', 'select', 'up', 'down', 'left', 'right'];
/** Keys a game might use: while one is being played these don't scroll or click focused buttons. */
const GAME_KEYS = new Set(['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const NAV_FIRST = 380;
const NAV_REPEAT = 140;

/**
 * Keyboard and gamepad input for game zones, read once per frame (`frame()`), with presses
 * edge-detected so a held button acts once. Walking input (`Input`) is switched off in zones;
 * this reads the same gamepad state from it and listens to the keyboard itself.
 */
export class ZoneInputState implements ZoneInput {
  /** Set by the zone manager: true while a game (not its end card) has the keyboard. */
  capture = false;
  private readonly keysHeld = new Set<string>();
  private keysQueued = new Set<string>();
  private keysNow = new Set<string>();
  private prev: Partial<Record<PadButton, boolean>> = {};
  private now: Partial<Record<PadButton, boolean>> = {};
  private navX = 0;
  private navY = 0;
  private navOut = { x: 0, y: 0 };
  private navAt = 0;

  constructor(private readonly input: Input) {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select')) return;
      if (this.capture && GAME_KEYS.has(e.code)) {
        // A button the player tabbed to keeps its own Enter/Space; anything else is the game's.
        if (target?.matches?.('button:focus-visible')) return;
        e.preventDefault();
      }
      if (e.repeat) return;
      this.keysHeld.add(e.code);
      this.keysQueued.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keysHeld.delete(e.code));
    window.addEventListener('blur', () => this.keysHeld.clear());
  }

  /** Call once per frame, after `Input.update()` and before the zones update. */
  frame(): void {
    this.keysNow = this.keysQueued;
    this.keysQueued = new Set();
    const pad = this.input.pad;
    this.prev = this.now;
    this.now = {};
    if (pad) for (const b of BUTTONS) this.now[b] = pad[b];

    // Menu-style steps: d-pad, a flick of the stick, or arrows/WASD, repeating while held.
    const s = pad ? { x: pad.lx, y: -pad.ly } : { x: 0, y: 0 };
    const dx = (this.held('right') || s.x > 0.55 || this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.held('left') || s.x < -0.55 || this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    const dy = (this.held('up') || s.y > 0.55 || this.key('ArrowUp', 'KeyW') ? 1 : 0) - (this.held('down') || s.y < -0.55 || this.key('ArrowDown', 'KeyS') ? 1 : 0);
    const t = performance.now();
    this.navOut = { x: 0, y: 0 };
    if ((dx || dy) && (dx !== this.navX || dy !== this.navY)) {
      this.navOut = { x: dx, y: dy };
      this.navAt = t + NAV_FIRST;
    } else if ((dx || dy) && t >= this.navAt) {
      this.navOut = { x: dx, y: dy };
      this.navAt = t + NAV_REPEAT;
    }
    this.navX = dx;
    this.navY = dy;
  }

  /** Forget anything pressed before a game started, so the press that entered doesn't act. */
  clear(): void {
    this.keysQueued.clear();
    this.keysNow.clear();
    this.prev = { ...this.now };
    this.navOut = { x: 0, y: 0 };
  }

  pad(): Pad | null {
    return this.input.pad;
  }

  pressed(button: PadButton): boolean {
    return !!this.now[button] && !this.prev[button];
  }

  held(button: PadButton): boolean {
    return !!this.now[button];
  }

  key(...codes: string[]): boolean {
    return codes.some((c) => this.keysHeld.has(c));
  }

  keyPressed(...codes: string[]): boolean {
    return codes.some((c) => this.keysNow.has(c));
  }

  stick(): { x: number; y: number } {
    const kx = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0);
    const ky = (this.key('ArrowUp', 'KeyW') ? 1 : 0) - (this.key('ArrowDown', 'KeyS') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return { x: kx / l, y: ky / l };
    }
    const pad = this.input.pad;
    if (!pad) return { x: 0, y: 0 };
    // The d-pad steers too, at full tilt.
    const x = pad.lx || (pad.right ? 1 : 0) - (pad.left ? 1 : 0);
    const y = -pad.ly || (pad.up ? 1 : 0) - (pad.down ? 1 : 0);
    return { x, y };
  }

  nav(): { x: number; y: number } {
    return this.navOut;
  }

  confirm(): boolean {
    return this.pressed('south') || this.keyPressed('Space');
  }

  confirmHeld(): boolean {
    return this.held('south') || this.key('Space');
  }

  device(): Device {
    return this.input.device;
  }
}
