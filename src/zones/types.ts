import type * as THREE from 'three';
import type { CameraRig } from '../engine/cameraRig';
import type { Device, Pad } from '../engine/input';
import type { Character } from '../character/character';
import type { ZoneUi } from '../world/zoneUi';

export type PadButton = 'south' | 'east' | 'west' | 'north' | 'lb' | 'rb' | 'start' | 'select' | 'up' | 'down' | 'left' | 'right';

/**
 * Keyboard and gamepad input for a game, read in `update()`. Presses are edge-detected per
 * frame. East (B / Circle) and Escape are taken by the world: they leave the game.
 */
export interface ZoneInput {
  /** The gamepad in use (sticks with dead zone, triggers 0..1), or null. */
  pad(): Pad | null;
  /** A gamepad button went down this frame. */
  pressed(button: PadButton): boolean;
  held(button: PadButton): boolean;
  /** Any of these keys (KeyboardEvent.code) is held. */
  key(...codes: string[]): boolean;
  /** Any of these keys went down this frame. */
  keyPressed(...codes: string[]): boolean;
  /** Left stick, d-pad or WASD/arrows. x right, y up (screen up / forward), length up to 1. */
  stick(): { x: number; y: number };
  /** One step per press (repeating while held): d-pad, stick flick, arrows/WASD. -1, 0 or 1. */
  nav(): { x: number; y: number };
  /** A / Cross, or Space, pressed this frame. */
  confirm(): boolean;
  confirmHeld(): boolean;
  /** The device used last (keyboard, touch, xbox or playstation). */
  device(): Device;
}

/** What the world hands a game zone. Everything is in world space unless noted. */
export interface ZoneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  canvas: HTMLCanvasElement;
  ui: ZoneUi;
  /** Keyboard and gamepad. Touch and mouse stay on the canvas (see `pointer()` in kit.ts). */
  input: ZoneInput;
  /** The zone's anchor in the world: build everything as children of this group. */
  root: THREE.Group;
  /** The player's character: zones may pose and animate it while the game runs. */
  player: {
    character: Character;
    /** Puts the character at a point given in the zone's local space. */
    place(local: THREE.Vector3, yaw: number): void;
  };
  /** 0 = full day, 1 = night. Zones like Trap Line darken the world. */
  setNight(amount: number): void;
  /** Today's seed (NZ date) unless overridden with ?seed=. */
  seed: string;
  /** True for the daily seed, false for a custom one. */
  daily: boolean;
  /** Ends the game and returns the player to walking. */
  exit(): void;
}

export interface GameZone {
  /** Called every frame while the zone is built (whether or not it is being played). */
  update(dt: number, elapsed: number): void;
  /** Starts a round. The world has already locked walking and shown the zone HUD. */
  start(): void;
  /** Called when the player leaves mid-game or after the end card. Reset to the idle set. */
  stop(): void;
  dispose(): void;
  /** Debug/test surface (exposed as window.__zone while playing). */
  debug?: Record<string, unknown>;
}

export interface ZoneModule {
  createZone(ctx: ZoneContext): Promise<GameZone>;
}

export interface ZoneDef {
  id: string;
  title: string;
  blurb: string;
  kind: 'fun' | 'learn';
  /** Anchor in the world, and which way the zone's local -Z faces (radians, Y rotation). */
  x: number;
  z: number;
  facing: number;
  /** Where the player stands to start, in zone local space. */
  start: { x: number; z: number };
  /** Lazy import of the zone's code, so each game is its own download. */
  load?: () => Promise<ZoneModule>;
  /** Hidden from the public world until a reviewer signs off (?preview shows it). */
  gated?: boolean;
  /** Radius of ground levelled flat for the game (0 = leave the ground as it is). */
  pad?: number;
  /** Radius kept clear of random trees and bushes. */
  clear?: number;
}
