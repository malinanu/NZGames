import * as THREE from 'three';

interface Circle {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
}

interface Box {
  kind: 'box';
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Rotation about Y. */
  rot: number;
}

export type Collider = Circle | Box;

/**
 * Flat 2D collision for walking: the player is a circle on the XZ plane, the world is a list
 * of circles and rotated boxes. Cheap enough to brute-force at this map size, but bucketed on
 * a grid so a few hundred trees cost nothing.
 */
export class Colliders {
  private readonly cell = 8;
  private readonly grid = new Map<string, Collider[]>();
  bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 50 };

  circle(x: number, z: number, r: number): void {
    this.insert({ kind: 'circle', x, z, r }, r);
  }

  box(x: number, z: number, w: number, d: number, rot = 0): void {
    this.insert({ kind: 'box', x, z, hx: w / 2, hz: d / 2, rot }, Math.hypot(w, d) / 2);
  }

  private insert(c: Collider, reach: number): void {
    const x0 = Math.floor((c.x - reach) / this.cell);
    const x1 = Math.floor((c.x + reach) / this.cell);
    const z0 = Math.floor((c.z - reach) / this.cell);
    const z1 = Math.floor((c.z + reach) / this.cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = `${gx},${gz}`;
        const list = this.grid.get(k) ?? [];
        list.push(c);
        this.grid.set(k, list);
      }
    }
  }

  /** True if a circle of this radius at (x, z) overlaps a large solid (used to keep the camera out of buildings). */
  blocked(x: number, z: number, radius: number): boolean {
    const gx = Math.floor(x / this.cell);
    const gz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const c of this.grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (c.kind === 'circle') {
            // Thin things (lamp posts, tree trunks) don't hide the player: ignore them.
            if (c.r >= 1.6 && Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
          } else if (Math.min(c.hx, c.hz) > 1.2) {
            const cos = Math.cos(c.rot);
            const sin = Math.sin(c.rot);
            const lx = (x - c.x) * cos - (z - c.z) * sin;
            const lz = (x - c.x) * sin + (z - c.z) * cos;
            if (Math.abs(lx) < c.hx + radius && Math.abs(lz) < c.hz + radius) return true;
          }
        }
      }
    }
    return false;
  }

  /** Pushes `p` (y ignored) out of anything it overlaps. */
  resolve(p: THREE.Vector3, radius: number): void {
    for (let pass = 0; pass < 2; pass++) {
      const seen = new Set<Collider>();
      const gx = Math.floor(p.x / this.cell);
      const gz = Math.floor(p.z / this.cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const c of this.grid.get(`${gx + dx},${gz + dz}`) ?? []) {
            if (seen.has(c)) continue;
            seen.add(c);
            if (c.kind === 'circle') this.pushCircle(p, radius, c);
            else this.pushBox(p, radius, c);
          }
        }
      }
    }
    p.x = THREE.MathUtils.clamp(p.x, this.bounds.minX, this.bounds.maxX);
    p.z = THREE.MathUtils.clamp(p.z, this.bounds.minZ, this.bounds.maxZ);
  }

  private pushCircle(p: THREE.Vector3, radius: number, c: Circle): void {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const min = radius + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 1e-4;
    p.x = c.x + (dx / d) * min;
    p.z = c.z + (dz / d) * min;
  }

  private pushBox(p: THREE.Vector3, radius: number, b: Box): void {
    const cos = Math.cos(b.rot);
    const sin = Math.sin(b.rot);
    // Into box space (three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos).
    const rx = p.x - b.x;
    const rz = p.z - b.z;
    const lx = rx * cos - rz * sin;
    const lz = rx * sin + rz * cos;
    const cx = THREE.MathUtils.clamp(lx, -b.hx, b.hx);
    const cz = THREE.MathUtils.clamp(lz, -b.hz, b.hz);
    let nx = lx - cx;
    let nz = lz - cz;
    let d = Math.hypot(nx, nz);
    if (d >= radius) return;
    let ox: number;
    let oz: number;
    if (d < 1e-5) {
      // Centre inside the box: leave by the nearest face.
      const px = b.hx - Math.abs(lx);
      const pz = b.hz - Math.abs(lz);
      if (px < pz) {
        nx = Math.sign(lx) || 1;
        nz = 0;
        d = 0;
        ox = nx * (b.hx + radius);
        oz = lz;
      } else {
        nx = 0;
        nz = Math.sign(lz) || 1;
        d = 0;
        ox = lx;
        oz = nz * (b.hz + radius);
      }
    } else {
      ox = cx + (nx / d) * radius;
      oz = cz + (nz / d) * radius;
    }
    // Back to world space.
    p.x = b.x + ox * cos + oz * sin;
    p.z = b.z - ox * sin + oz * cos;
  }
}
