import * as THREE from 'three';
import type { Colliders } from '../engine/colliders';
import type { Input } from '../engine/input';
import type { Character } from './character';
import { groundHeight, SEA_LEVEL, seaDepth, SWIM_DEPTH, walkable } from '../world/terrain';

const WALK = 2.6;
const RUN = 6.2;
const ACCEL = 14;
const TURN = 12;
const GRAVITY = 22;
const JUMP = 7.2;
const RADIUS = 0.38;
const SWIM = 1.9;
/** How far below the surface the root sits while swimming (shoulders at the water line). */
const SWIM_SINK = 0.42;

export type WaterState = 'dry' | 'wade' | 'swim';

/** Moves the player character relative to the camera and picks the matching animation. */
export class PlayerController {
  readonly position = new THREE.Vector3();
  yaw = 0;
  private readonly velocity = new THREE.Vector3();
  private vy = 0;
  private grounded = true;
  private landing = 0;
  /** Dry land, wading (slower, no running) or swimming. */
  water: WaterState = 'dry';
  /** Water depth under the player, in metres. */
  depth = 0;
  /** While false the controller leaves the character alone (zones pose it themselves). */
  active = true;

  constructor(
    readonly character: Character,
    private readonly colliders: Colliders,
  ) {}

  place(x: number, z: number, yaw: number): void {
    this.position.set(x, groundHeight(x, z), z);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.sync();
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt: number, input: Input, cameraYaw: number): void {
    if (!this.active) return;
    // Camera-relative: stick up walks away from the camera.
    const fwd = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3()
      .addScaledVector(fwd, input.move.y)
      .addScaledVector(right, input.move.x);
    const amount = Math.min(1, want.length());
    if (amount > 0) want.normalize();
    // Water drags at the legs: slower the deeper it gets, no running, and swimming is slower still.
    const drag = this.water === 'swim' ? SWIM : this.water === 'wade' ? WALK * (1 - Math.min(this.depth / SWIM_DEPTH, 1) * 0.45) : input.run ? RUN : WALK;
    const target = want.multiplyScalar(amount * drag);
    const k = 1 - Math.exp(-dt * ACCEL);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;

    if (this.water === 'swim') input.consumeJump();
    else if (this.grounded && input.consumeJump()) {
      this.vy = JUMP;
      this.grounded = false;
      this.character.play('Jump_Start', { fade: 0.08, then: () => this.character.play('Jump_Idle', { fade: 0.1 }) });
    }
    this.vy -= GRAVITY * dt;
    const fromX = this.position.x;
    const fromZ = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.colliders.resolve(this.position, RADIUS);
    // Deep water and the edge of the world turn you back.
    if (!walkable(this.position.x, this.position.z)) {
      this.position.x = fromX;
      this.position.z = fromZ;
      this.velocity.set(0, 0, 0);
    }
    this.depth = seaDepth(this.position.x, this.position.z);
    this.water = this.depth > SWIM_DEPTH ? 'swim' : this.depth > 0.12 ? 'wade' : 'dry';
    // Swimmers float with their shoulders at the surface instead of walking on the sea floor.
    const floor = groundHeight(this.position.x, this.position.z);
    const ground = this.water === 'swim' ? Math.max(floor, SEA_LEVEL - SWIM_SINK) : floor;
    this.position.y += this.vy * dt;
    if (this.position.y <= ground || (this.grounded && this.position.y - ground < 0.5)) {
      if (!this.grounded) {
        this.landing = 0.22;
        this.character.play('Jump_Land', { fade: 0.06, speed: 1.6 });
      }
      // Ease onto small steps (kerbs, ramps) instead of popping.
      this.position.y = this.grounded ? this.position.y + (ground - this.position.y) * Math.min(1, dt * 18) : ground;
      this.vy = 0;
      this.grounded = true;
    }

    const speed = this.speed;
    if (speed > 0.15) {
      const face = Math.atan2(this.velocity.x, this.velocity.z);
      let d = face - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * TURN));
    }
    this.landing = Math.max(0, this.landing - dt);
    if (this.water === 'swim' && this.grounded) {
      // KayKit has no swim clip; the crawl's reaching arms read as front crawl at the surface.
      this.character.play('Crawling', { speed: speed > 0.3 ? Math.max(0.8, speed / SWIM) : 0.35, fade: 0.25 });
    } else if (this.grounded && this.landing === 0) {
      if (speed > 4.2) this.character.play('Running_A', { speed: speed / RUN * 1.05 });
      else if (speed > 0.3) this.character.play('Walking_A', { speed: Math.max(0.7, speed / WALK) });
      else this.character.play('Idle_A', { fade: 0.3 });
    }
    this.sync();
  }

  sync(): void {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
  }
}
