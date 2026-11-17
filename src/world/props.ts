import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, group, paint } from './build';

/** Procedural props for things the asset packs don't have. All stand on y = 0, in metres. */

/** Park bench with a backrest. Sit facing +Z; seat top is 0.46 m up. */
export const BENCH_SEAT = 0.46;
export function parkBench(colour = '#9c6b3f'): THREE.Group {
  const g = group();
  for (let i = 0; i < 3; i++) g.add(box(1.7, 0.05, 0.13, colour, 0, BENCH_SEAT - 0.025, -0.14 + i * 0.15));
  for (let i = 0; i < 2; i++) g.add(box(1.7, 0.13, 0.04, colour, 0, 0.68 + i * 0.17, -0.25));
  for (const x of [-0.75, 0.75]) {
    g.add(box(0.07, BENCH_SEAT, 0.42, '#3b3f46', x, BENCH_SEAT / 2, 0));
    g.add(box(0.07, 0.5, 0.06, '#3b3f46', x, 0.7, -0.27));
  }
  return g;
}

/** A proper beach umbrella: pole in the sand, striped canopy. */
export function beachUmbrella(a: string, b = '#fbfbf6'): THREE.Group {
  const g = group(cyl(0.03, 0.03, 2.2, '#e9e4d8', 0, 1.1, 0, 8));
  const panels = 8;
  for (let i = 0; i < panels; i++) {
    const geo = new THREE.ConeGeometry(1.45, 0.5, panels, 1, true, (i / panels) * Math.PI * 2, (Math.PI * 2) / panels);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: i % 2 ? a : b, side: THREE.DoubleSide }));
    m.position.y = 2.2;
    m.castShadow = true;
    g.add(m);
  }
  g.add(cyl(0.05, 0.05, 0.08, a, 0, 2.48, 0, 8));
  g.rotation.z = 0.08;
  return g;
}

export function surfboard(colour: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), paint(colour));
  m.scale.set(0.27, 0.04, 1.05);
  m.castShadow = true;
  return m;
}

/** A classic six-panel beach ball, about 0.7 m across. */
export function beachBall(): THREE.Group {
  const g = new THREE.Group();
  const colours = ['#ff4fa3', '#fbfbf6', '#27c4f5', '#fbfbf6', '#ffd23f', '#fbfbf6'];
  colours.forEach((c, i) => {
    const panel = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 10, (i * Math.PI) / 3, Math.PI / 3), paint(c));
    panel.castShadow = true;
    g.add(panel);
  });
  return g;
}

export function letterbox(colour: string): THREE.Group {
  return group(box(0.08, 1, 0.08, '#e9e4d8', 0, 0.5, 0), box(0.24, 0.2, 0.42, colour, 0, 1.08, 0));
}

export function washingLine(): THREE.Group {
  const g = group(cyl(0.035, 0.035, 2.1, '#b8bcc4', 0, 1.05, 0, 8));
  const colours = ['#e8578e', '#27c4f5', '#ffd23f', '#fbfbf6', '#3e8e4e'];
  for (let i = 0; i < 4; i++) {
    const arm = box(2.2, 0.03, 0.03, '#b8bcc4', 0, 2.05, 0);
    arm.rotation.y = (i * Math.PI) / 4;
    g.add(arm);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const cloth = box(0.42, 0.5, 0.02, colours[i], Math.cos(a) * 0.8, 1.76, Math.sin(a) * 0.8);
    cloth.rotation.y = -a + Math.PI / 2;
    g.add(cloth);
  }
  return g;
}

export function caravan(stripe: string): THREE.Group {
  const g = group(
    box(4.2, 1.9, 2.1, '#f7f4ea', 0, 1.35, 0),
    box(4.22, 0.28, 2.12, stripe, 0, 1.0, 0),
    box(1.1, 0.75, 0.04, '#7fb6d6', -0.9, 1.75, 1.06),
    box(0.7, 1.5, 0.04, '#e9e4d8', 1.2, 1.2, 1.06),
    box(0.9, 0.08, 0.08, '#3b3f46', 2.5, 0.55, 0),
  );
  for (const x of [-0.6, 0.6]) {
    const wheel = cyl(0.36, 0.36, 0.22, '#2a2d33', x, 0.36, 1.0, 14);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel, wheel.clone().translateY(-2.0));
  }
  // Awning.
  const awning = box(3.2, 0.05, 1.8, stripe, 0, 2.25, 1.9);
  awning.rotation.x = 0.16;
  g.add(awning, cyl(0.03, 0.03, 2.0, '#b8bcc4', -1.5, 1.0, 2.7, 6), cyl(0.03, 0.03, 2.0, '#b8bcc4', 1.5, 1.0, 2.7, 6));
  return g;
}

export function hayBale(): THREE.Mesh {
  const m = cyl(0.75, 0.75, 1.3, '#dcc26a', 0, 0.75, 0, 16);
  m.rotation.z = Math.PI / 2;
  return m;
}

export function dinghy(colour: string): THREE.Group {
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }));
  hull.scale.set(0.75, 0.5, 1.7);
  hull.position.y = 0.45;
  hull.castShadow = true;
  return group(hull, box(1.2, 0.05, 0.25, '#c9995a', 0, 0.36, 0.2), box(1.0, 0.05, 0.25, '#c9995a', 0, 0.36, -0.7));
}

/** White tower, red band, lantern room. About 13 m tall. */
export function lighthouse(): THREE.Group {
  const g = group(
    cyl(1.9, 2.6, 9, '#fbfbf6', 0, 4.5, 0, 16),
    cyl(2.05, 2.25, 1.6, '#d7263d', 0, 5.6, 0, 16),
    cyl(2.4, 2.4, 0.2, '#3b3f46', 0, 9.1, 0, 16),
    cyl(1.3, 1.3, 1.7, '#ffe9a3', 0, 10.05, 0, 12),
    box(0.8, 1.7, 0.1, '#7a5a3a', 0, 0.85, 2.52),
  );
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.3, 12), paint('#d7263d'));
  cap.position.y = 11.55;
  cap.castShadow = true;
  (g.children[3] as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
  g.add(cap);
  return g;
}

export function trigPoint(): THREE.Group {
  const g = group(cyl(0.5, 0.6, 0.3, '#c9c4b8', 0, 0.15, 0, 4));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = box(0.07, 2.7, 0.07, '#fbfbf6', Math.cos(a) * 0.3, 1.5, Math.sin(a) * 0.3);
    leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
    g.add(leg);
  }
  g.add(box(0.5, 0.5, 0.5, '#1b1b1f', 0, 2.9, 0));
  return g;
}

/** Red-and-yellow surf patrol flag. */
export function patrolFlag(): THREE.Group {
  return group(cyl(0.03, 0.03, 2.6, '#e9e4d8', 0, 1.3, 0, 6), box(0.02, 0.5, 0.8, '#d7263d', 0, 2.3, 0.42), box(0.02, 0.5, 0.8, '#ffd23f', 0, 1.8, 0.42));
}

export function patrolTower(): THREE.Group {
  const g = group(box(2.2, 0.12, 2.2, '#c9995a', 0, 2.2, 0), box(2.2, 1.0, 0.08, '#ffd23f', 0, 2.75, -1.06), box(0.08, 1.0, 2.2, '#d7263d', -1.06, 2.75, 0), box(0.08, 1.0, 2.2, '#d7263d', 1.06, 2.75, 0), box(2.5, 0.1, 2.5, '#d7263d', 0, 4.1, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.12, 4.1, 0.12, '#e9e4d8', x, 2.05, z));
  const ladder = box(0.7, 2.6, 0.06, '#c9995a', 0, 1.1, 1.5);
  ladder.rotation.x = -0.45;
  g.add(ladder);
  return g;
}

/** A length of post-and-wire farm fence, centred, running along X. */
export function wireFence(length: number): THREE.Group {
  const g = group();
  const posts = Math.max(2, Math.round(length / 3) + 1);
  for (let i = 0; i < posts; i++) g.add(box(0.1, 1.15, 0.1, '#8a6a45', -length / 2 + (i * length) / (posts - 1), 0.57, 0));
  for (const y of [0.35, 0.65, 0.95]) g.add(box(length, 0.02, 0.02, '#9aa0a8', 0, y, 0));
  return g;
}

/** Timber deck with piles: the jetty and the bridges. Runs along Z, centred. */
export function deck(length: number, width: number, pileDepth: number, rails: boolean): THREE.Group {
  const g = group(box(width, 0.14, length, '#b08a5c', 0, -0.07, 0));
  const planks = Math.floor(length / 0.5);
  for (let i = 0; i < planks; i += 2) g.add(box(width, 0.012, 0.44, '#9c7648', 0, 0.004, -length / 2 + 0.25 + i * 0.5));
  for (let z = -length / 2 + 0.6; z <= length / 2; z += 4.5) {
    for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) g.add(cyl(0.16, 0.16, pileDepth + (rails ? 1.0 : 0.25), '#6b5038', x, -pileDepth / 2 + (rails ? 0.5 : 0.12), z, 8));
  }
  if (rails) for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) g.add(box(0.07, 0.07, length, '#8a6a45', x, 0.98, 0));
  return g;
}

export function cameraStand(): THREE.Group {
  const g = group(box(0.34, 0.24, 0.2, '#2a2d33', 0, 1.42, 0), cyl(0.09, 0.09, 0.14, '#1b1b1f', 0, 1.42, 0.14, 12), box(0.9, 0.6, 0.04, '#ffd23f', 0, 2.1, 0));
  (g.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.025, 0.025, 1.4, '#3b3f46', Math.cos(a) * 0.22, 0.66, Math.sin(a) * 0.22, 6);
    leg.rotation.set(Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32);
    g.add(leg);
  }
  g.add(cyl(0.02, 0.02, 0.5, '#3b3f46', 0, 1.78, 0, 6));
  return g;
}

/** Simple swing set and slide for the playground. */
export function swingSet(): THREE.Group {
  const g = group(box(3.2, 0.1, 0.1, '#d7263d', 0, 2.4, 0));
  for (const x of [-1.6, 1.6]) for (const s of [-1, 1]) {
    const leg = box(0.1, 2.5, 0.1, '#d7263d', x, 1.2, s * 0.5);
    leg.rotation.x = s * 0.2;
    g.add(leg);
  }
  for (const x of [-0.7, 0.7]) g.add(box(0.02, 1.8, 0.02, '#9aa0a8', x - 0.2, 1.5, 0), box(0.02, 1.8, 0.02, '#9aa0a8', x + 0.2, 1.5, 0), box(0.5, 0.05, 0.2, '#27c4f5', x, 0.6, 0));
  return g;
}

export function slide(): THREE.Group {
  const chute = box(0.7, 0.06, 3.2, '#ffd23f', 0, 1.0, 1.3);
  chute.rotation.x = 0.6;
  const g = group(box(1.1, 0.1, 1.1, '#27c4f5', 0, 1.9, -0.5), chute);
  for (const [x, z] of [[-0.5, -1], [0.5, -1], [-0.5, 0], [0.5, 0]]) g.add(box(0.1, 1.9, 0.1, '#d7263d', x, 0.95, z));
  return g;
}

/** Rock face with falling water and a pool. Faces +Z. */
export function waterfall(): { object: THREE.Group; water: THREE.Mesh } {
  const g = group();
  for (let i = 0; i < 9; i++) {
    const w = 2.2 + ((i * 37) % 10) / 6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(w, 0), paint(i % 2 ? '#7d8288' : '#6a6f76'));
    rock.position.set(-7 + i * 1.75, 1.5 + ((i * 53) % 7) / 2.2, -1.5 - ((i * 29) % 5) / 4);
    rock.scale.y = 1.5;
    rock.castShadow = true;
    g.add(rock);
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 7, 1, 12), new THREE.MeshBasicMaterial({ color: '#dff6ff', transparent: true, opacity: 0.85 }));
  water.position.set(0, 3.6, 0.95);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24), new THREE.MeshLambertMaterial({ color: '#3fc8c4', transparent: true, opacity: 0.85 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.12, 4.5);
  g.add(water, pool);
  return { object: g, water };
}

export function bbqShelter(): THREE.Group {
  const g = group(box(5, 0.16, 4, '#8a3b2e', 0, 2.9, 0), box(4.6, 0.1, 3.6, '#c9c4b8', 0, 0.05, 0), box(1.6, 0.9, 0.7, '#3b3f46', 0, 0.5, -1.2), box(1.6, 0.06, 0.7, '#9aa0a8', 0, 0.98, -1.2));
  for (const [x, z] of [[-2.3, -1.8], [2.3, -1.8], [-2.3, 1.8], [2.3, 1.8]]) g.add(box(0.16, 2.9, 0.16, '#6b5038', x, 1.45, z));
  return g;
}

/** Sign board on a post, with a painted label. */
export function signpost(text: string, colour = '#1d5c3f'): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = '#ffd23f';
  ctx.font = '600 72px Fredoka, Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 84, 480);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: tex });
  const side = paint(colour);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.07), [side, side, side, side, face, face]);
  board.position.y = 2.0;
  board.castShadow = true;
  return group(box(0.1, 2.3, 0.1, '#6b5038', 0, 1.15, 0), board);
}

/** Red corrugated-iron woolshed. About 10 m long; door faces +Z. */
export function woolshed(): THREE.Group {
  const g = group(box(10, 4, 7, '#a8322a', 0, 2, 0), box(2.6, 3, 0.12, '#f4f0e6', 0, 1.5, 3.52), box(2.2, 2.7, 0.14, '#6e1f1a', 0, 1.35, 3.54));
  for (const s of [-1, 1]) {
    const roof = box(10.6, 0.16, 4.2, '#b9bec6', 0, 4.95, s * 1.85);
    roof.rotation.x = s * 0.5;
    g.add(roof, box(0.9, 0.9, 0.1, '#f4f0e6', s * 3.4, 2.6, 3.52));
  }
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.04, 1.9, 4, 1), paint('#a8322a'));
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(1.73, 1, 0.866);
  gable.position.y = 4.95;
  g.add(gable);
  return g;
}

/**
 * Harakeke (New Zealand flax): a fan of long, stiff, dark green blades, some clumps with a
 * tall flower stalk. One merged geometry, instanced for every clump. Height is about 1.6 m.
 */
let flaxGeo: { leaves: THREE.BufferGeometry; stalk: THREE.BufferGeometry } | null = null;
function flaxGeometry(): { leaves: THREE.BufferGeometry; stalk: THREE.BufferGeometry } {
  if (flaxGeo) return flaxGeo;
  const blades: THREE.BufferGeometry[] = [];
  const count = 22;
  for (let i = 0; i < count; i++) {
    const len = 1.3 + ((i * 37) % 11) / 14;
    const blade = new THREE.PlaneGeometry(0.22, len, 1, 6);
    const pos = blade.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + len / 2; // 0 at the base
      const t = y / len;
      // Taper to a point and arch outwards towards the tip.
      pos.setX(k, pos.getX(k) * (1 - t * 0.8));
      pos.setY(k, y * (1 - t * 0.12));
      pos.setZ(k, t * t * len * 0.45);
    }
    blade.computeVertexNormals();
    const lean = 0.12 + ((i * 53) % 7) / 16;
    blade.rotateX(-lean);
    blade.rotateY((i / count) * Math.PI * 2 + (i % 3) * 0.2);
    blades.push(blade);
  }
  const leaves = mergeGeometries(blades)!;
  const stalk = mergeGeometries([
    new THREE.CylinderGeometry(0.025, 0.04, 2.6, 5).translate(0, 1.3, 0),
    new THREE.CylinderGeometry(0.07, 0.05, 0.4, 6).translate(0.07, 2.4, 0),
    new THREE.CylinderGeometry(0.06, 0.04, 0.32, 6).translate(-0.06, 2.1, 0),
  ])!;
  flaxGeo = { leaves, stalk };
  return flaxGeo;
}

export function flaxClumps(places: { x: number; y: number; z: number; rot?: number; scale?: number }[]): THREE.Group {
  const { leaves, stalk } = flaxGeometry();
  const leafMat = new THREE.MeshLambertMaterial({ color: '#3f6a34', side: THREE.DoubleSide });
  const stalkMat = new THREE.MeshLambertMaterial({ color: '#6b3a2a' });
  const flowering = places.filter((_, i) => i % 3 === 0);
  const a = new THREE.InstancedMesh(leaves, leafMat, places.length);
  const b = new THREE.InstancedMesh(stalk, stalkMat, Math.max(1, flowering.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const put = (mesh: THREE.InstancedMesh, list: typeof places) =>
    list.forEach((p, i) => {
      const sc = p.scale ?? 1;
      q.setFromAxisAngle(up, p.rot ?? 0);
      m.compose(new THREE.Vector3(p.x, p.y - 0.03, p.z), q, new THREE.Vector3(sc, sc, sc));
      mesh.setMatrixAt(i, m);
    });
  put(a, places);
  put(b, flowering);
  b.count = flowering.length;
  for (const mesh of [a, b]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
  }
  return group(a, b);
}
