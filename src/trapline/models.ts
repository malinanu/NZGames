import * as THREE from 'three';
import type { Species } from './sim';

/** Small procedural pieces in the chunky KayKit style: there are no NZ animals in the packs. */

function mat(colour: string, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness });
}

function part(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

export const SPECIES_COLOUR: Record<Species, string> = { rat: '#8a8f99', stoat: '#b0703c', possum: '#5d5560' };
export const SPECIES_NAME: Record<Species, string> = { rat: 'Rat', stoat: 'Stoat', possum: 'Possum' };

/** Critters face -Z and stand on y = 0. */
export function buildPredator(species: Species): THREE.Group {
  const g = new THREE.Group();
  const fur = mat(SPECIES_COLOUR[species]);
  const eye = new THREE.MeshBasicMaterial({ color: '#fff3a0' });
  if (species === 'rat') {
    g.add(part(new THREE.CapsuleGeometry(0.11, 0.2, 4, 8).rotateX(Math.PI / 2), fur, 0, 0.13, 0));
    g.add(part(new THREE.ConeGeometry(0.08, 0.16, 8).rotateX(-Math.PI / 2), fur, 0, 0.12, -0.26));
    for (const s of [-1, 1]) g.add(part(new THREE.SphereGeometry(0.05, 8, 6), mat('#e7a6b0'), s * 0.07, 0.24, -0.16));
    g.add(part(new THREE.CylinderGeometry(0.015, 0.008, 0.34, 5).rotateX(Math.PI / 2), mat('#e7a6b0'), 0, 0.08, 0.36));
  } else if (species === 'stoat') {
    // Long and low, pale belly, black tail tip.
    g.add(part(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8).rotateX(Math.PI / 2), fur, 0, 0.13, 0));
    g.add(part(new THREE.CapsuleGeometry(0.06, 0.38, 4, 8).rotateX(Math.PI / 2), mat('#f3ead8'), 0, 0.09, 0));
    g.add(part(new THREE.SphereGeometry(0.085, 8, 6), fur, 0, 0.2, -0.3));
    for (const s of [-1, 1]) g.add(part(new THREE.SphereGeometry(0.03, 6, 5), fur, s * 0.06, 0.28, -0.29));
    g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6).rotateX(Math.PI / 2), fur, 0, 0.13, 0.36));
    g.add(part(new THREE.SphereGeometry(0.04, 6, 5), mat('#1b1b1f'), 0, 0.13, 0.48));
  } else {
    // Brushtail possum: round body, pointed ears, thick dark tail.
    g.add(part(new THREE.SphereGeometry(0.19, 10, 8).scale(1, 0.9, 1.25), fur, 0, 0.19, 0));
    g.add(part(new THREE.SphereGeometry(0.12, 10, 8), fur, 0, 0.27, -0.24));
    for (const s of [-1, 1]) g.add(part(new THREE.ConeGeometry(0.045, 0.11, 6), mat('#d9a7a7'), s * 0.08, 0.4, -0.22));
    g.add(part(new THREE.CapsuleGeometry(0.06, 0.26, 4, 6).rotateX(Math.PI / 2.6), mat('#2b2630'), 0, 0.2, 0.36));
  }
  const headZ = species === 'stoat' ? -0.37 : species === 'rat' ? -0.3 : -0.34;
  const headY = species === 'possum' ? 0.3 : species === 'stoat' ? 0.22 : 0.16;
  for (const s of [-1, 1]) g.add(part(new THREE.SphereGeometry(0.022, 6, 5), eye, s * 0.045, headY, headZ));
  g.scale.setScalar(1.5);
  return g;
}

/** A wooden box trap with a mesh end, plus a flag that pops up when it has caught something. */
export function buildTrap(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.34, 0.24, 0.62), mat('#c9995a'), 0, 0.12, 0));
  g.add(part(new THREE.BoxGeometry(0.38, 0.04, 0.66), mat('#a87a41'), 0, 0.26, 0));
  g.add(part(new THREE.BoxGeometry(0.2, 0.15, 0.02), mat('#2a2a2a'), 0, 0.1, 0.32));
  const flag = new THREE.Group();
  flag.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), mat('#444'), 0, 0.5, 0));
  flag.add(part(new THREE.BoxGeometry(0.22, 0.14, 0.02), mat('#ff5a3c'), 0.11, 0.68, 0));
  flag.name = 'flag';
  flag.visible = false;
  g.add(flag);
  return g;
}

/** A black tracking tunnel: predators walk through and leave inked footprints. */
export function buildTunnel(): THREE.Group {
  const g = new THREE.Group();
  const tube = new THREE.CylinderGeometry(0.15, 0.15, 0.7, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  const shell = part(tube, new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.6, side: THREE.DoubleSide }), 0, 0.02, 0);
  g.add(shell);
  g.add(part(new THREE.BoxGeometry(0.26, 0.015, 0.68), mat('#f2f2ea'), 0, 0.02, 0));
  return g;
}

export function buildNest(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.TorusGeometry(0.17, 0.07, 6, 12).rotateX(Math.PI / 2), mat('#7a5a34'), 0, 0.07, 0));
  const eggs = new THREE.Group();
  eggs.name = 'eggs';
  const shell = mat('#f6f1df', 0.5);
  eggs.add(part(new THREE.SphereGeometry(0.065, 8, 6).scale(1, 1.25, 1), shell, -0.05, 0.11, 0.02));
  eggs.add(part(new THREE.SphereGeometry(0.065, 8, 6).scale(1, 1.25, 1), shell, 0.06, 0.11, -0.03));
  g.add(eggs);
  return g;
}

/** A little bird that turns up on a nest that made it through the night. */
export function buildBird(colour: string): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.SphereGeometry(0.11, 10, 8).scale(1, 0.95, 1.2), mat(colour), 0, 0.13, 0));
  g.add(part(new THREE.SphereGeometry(0.075, 8, 6), mat(colour), 0, 0.25, -0.08));
  g.add(part(new THREE.ConeGeometry(0.025, 0.09, 5).rotateX(-Math.PI / 2), mat('#f0b23a'), 0, 0.25, -0.18));
  g.add(part(new THREE.BoxGeometry(0.05, 0.02, 0.16), mat(colour), 0, 0.14, 0.17));
  return g;
}

/** Crimson pōhutukawa blossom scattered over a canopy of the given size. */
export function buildBlossom(width: number, height: number, rng: () => number): THREE.InstancedMesh {
  const count = 22;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), mat('#d7263d', 0.6), count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const up = 0.35 + rng() * 0.6; // upper part of the tree only
    const radius = (width / 2) * Math.sqrt(1 - (up - 0.45) ** 2) * (0.75 + rng() * 0.2);
    const s = 0.7 + rng() * 0.8;
    m.makeScale(s, s, s).setPosition(Math.cos(a) * radius, height * up, Math.sin(a) * radius);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true;
  return mesh;
}

export function buildHex(size: number, colour: string, height = 0.5): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(size, size, height, 6), mat(colour));
  mesh.position.y = -height / 2;
  mesh.receiveShadow = true;
  return mesh;
}
