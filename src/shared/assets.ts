import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Everything lives under /models next to the page (Vite base is relative). */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Loads (once) any glTF/GLB under /models. `path` includes the extension. */
export function loadGltf(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(assetUrl(`models/${path}`)).then((gltf) => {
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      return gltf;
    });
    cache.set(path, p);
  }
  return p;
}

function loadProp(path: string): Promise<THREE.Group> {
  return loadGltf(`${path}.gltf`).then((g) => g.scene);
}

export interface Prop {
  /** Group with its origin at the centre of the footprint, resting on y = 0. */
  object: THREE.Group;
  /** Final size in metres after scaling. */
  size: THREE.Vector3;
}

export interface PropOptions {
  /** Scale uniformly so the longest horizontal side is this many metres. */
  width?: number;
  /** Scale uniformly so the model is this many metres tall (overrides width). */
  height?: number;
  /** Plain uniform scale (used when neither width nor height is given). */
  scale?: number;
}

interface Normalised {
  /** Moves the model so its footprint centre sits on the origin at y = 0. */
  offset: THREE.Vector3;
  scale: number;
  size: THREE.Vector3;
}

function normalise(model: THREE.Object3D, opts: PropOptions): Normalised {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  let scale = opts.scale ?? 1;
  if (opts.height) scale = opts.height / size.y;
  else if (opts.width) scale = opts.width / Math.max(size.x, size.z);
  return { offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z), scale, size: size.multiplyScalar(scale) };
}

/**
 * KayKit packs use different unit scales, so props are normalised here:
 * re-centred on their footprint and scaled to a real-world size.
 */
export async function spawnProp(path: string, opts: PropOptions = {}): Promise<Prop> {
  const model = (await loadProp(path)).clone(true);
  const n = normalise(model, opts);
  model.position.copy(n.offset);
  const object = new THREE.Group();
  object.add(model);
  object.scale.setScalar(n.scale);
  return { object, size: n.size };
}

export interface Placement {
  x: number;
  z: number;
  y?: number;
  rot?: number;
  /** Multiplies the normalised size. */
  scale?: number;
}

/**
 * Many copies of one prop as instanced meshes: one draw call per material instead of one per
 * copy. Used for trees, grass, fences, rocks and anything else that repeats.
 */
const SCATTER_CELL = 80;

export async function scatter(path: string, opts: PropOptions, places: Placement[]): Promise<THREE.Group> {
  const model = await loadProp(path);
  model.updateMatrixWorld(true);
  const n = normalise(model, opts);
  const group = new THREE.Group();
  group.name = `scatter:${path}`;
  if (!places.length) return group;
  const base = new THREE.Matrix4().makeTranslation(n.offset.x, n.offset.y, n.offset.z);
  const placement = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // One instanced mesh per material per 80 m cell rather than one across the whole map, so
  // frustum (and shadow camera) culling can drop the cells out of view.
  const cells = new Map<string, Placement[]>();
  for (const p of places) {
    const key = `${Math.floor(p.x / SCATTER_CELL)},${Math.floor(p.z / SCATTER_CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(p);
  }
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const local = base.clone().multiply(mesh.matrixWorld);
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      im.castShadow = true;
      im.receiveShadow = true;
      list.forEach((p, i) => {
        const s = n.scale * (p.scale ?? 1);
        q.setFromAxisAngle(up, p.rot ?? 0);
        placement.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, placement.clone().multiply(local));
      });
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}
