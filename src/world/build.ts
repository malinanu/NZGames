import * as THREE from 'three';
import { scatter, spawnProp, type Placement, type PropOptions } from '../shared/assets';
import type { Colliders } from '../engine/colliders';
import { groundHeight } from './terrain';

/** Somewhere a character can be put so it looks right: on a bench, a towel, the jetty edge. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: 'bench' | 'chair' | 'towel' | 'ground' | 'fish' | 'stand' | 'work';
  taken?: boolean;
}

/** Named place for the map, fast travel and the "where am I" label. */
export interface Place {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface PutOptions extends PropOptions {
  rot?: number;
  /** Extra height above the ground. */
  lift?: number;
  /** Collider: true = box from the prop's footprint, number = circle radius. */
  solid?: boolean | number;
  /** Set when the prop is meant to float or sink, so the grounding audit skips it. */
  ungrounded?: boolean;
}

/**
 * Everything the districts use to place things. Every prop goes through here, so it always
 * sits on the ground at its spot and is recorded for the grounding audit.
 */
export class Builder {
  readonly seats: Seat[] = [];
  readonly places: Place[] = [];
  private readonly jobs: Promise<unknown>[] = [];
  private readonly placed: { name: string; object: THREE.Object3D; x: number; z: number; lift: number }[] = [];

  constructor(
    readonly scene: THREE.Scene,
    readonly colliders: Colliders,
  ) {}

  /** One prop from the packs, resting on the ground. */
  put(model: string, x: number, z: number, opts: PutOptions = {}): void {
    this.jobs.push(
      spawnProp(model, opts).then((p) => {
        const lift = opts.lift ?? 0;
        p.object.position.set(x, groundHeight(x, z) + lift, z);
        p.object.rotation.y = opts.rot ?? 0;
        this.scene.add(p.object);
        if (!opts.ungrounded) this.placed.push({ name: model, object: p.object, x, z, lift });
        if (opts.solid === true) this.colliders.box(x, z, p.size.x, p.size.z, opts.rot ?? 0);
      }),
    );
    if (typeof opts.solid === 'number') this.colliders.circle(x, z, opts.solid);
  }

  /** Many copies of one prop, each dropped onto the ground. */
  many(model: string, opts: PropOptions, places: Placement[], solid = 0): void {
    const grounded = places.map((p) => ({ ...p, y: groundHeight(p.x, p.z) + (p.y ?? 0) }));
    this.jobs.push(scatter(model, opts, grounded).then((g) => this.scene.add(g)));
    if (solid) for (const p of places) this.colliders.circle(p.x, p.z, solid * (p.scale ?? 1));
  }

  /** A procedural object, placed on the ground. */
  add(object: THREE.Object3D, x: number, z: number, rot = 0, lift = 0): THREE.Object3D {
    object.position.set(x, groundHeight(x, z) + lift, z);
    object.rotation.y = rot;
    this.scene.add(object);
    return object;
  }

  seat(kind: Seat['kind'], x: number, z: number, yaw: number, lift = 0): void {
    this.seats.push({ kind, x, z, yaw, y: groundHeight(x, z) + lift });
  }

  place(id: string, name: string, x: number, z: number, radius: number): void {
    this.places.push({ id, name, x, z, radius });
  }

  async done(): Promise<void> {
    await Promise.all(this.jobs);
  }

  /**
   * Grounding audit: every pack prop's lowest point should be on the ground at its spot.
   * Returns the ones that float or sink by more than `tolerance` metres.
   */
  audit(tolerance = 0.08): string[] {
    const problems: string[] = [];
    const box = new THREE.Box3();
    for (const p of this.placed) {
      p.object.updateMatrixWorld(true);
      box.setFromObject(p.object);
      const off = box.min.y - (groundHeight(p.x, p.z) + p.lift);
      if (Math.abs(off) > tolerance) problems.push(`${p.name} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) is ${off > 0 ? 'floating' : 'sunk'} by ${Math.abs(off).toFixed(2)} m`);
    }
    return problems;
  }
}

// ---------------------------------------------------------------------------
// Small shape helpers for procedural props
// ---------------------------------------------------------------------------
const materials = new Map<string, THREE.MeshLambertMaterial>();
export function paint(colour: string): THREE.MeshLambertMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: colour });
    materials.set(colour, m);
  }
  return m;
}

export function box(w: number, h: number, d: number, colour: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint(colour));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(rTop: number, rBottom: number, h: number, colour: string, x = 0, y = 0, z = 0, segments = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), paint(colour));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
}
