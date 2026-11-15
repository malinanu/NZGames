import type * as THREE from 'three';
import type { CameraRig } from '../engine/cameraRig';
import type { Character } from '../character/character';
import type { ZoneUi } from '../world/zoneUi';

/** What the world hands a game zone. Everything is in world space unless noted. */
export interface ZoneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  canvas: HTMLCanvasElement;
  ui: ZoneUi;
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
}
