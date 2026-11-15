import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();


function modelUrl(path: string): string {
  // Pages live one level below the site root (e.g. /jandal-flip/), models at /models.
  const root = import.meta.env.DEV ? '/' : new URL('../', document.baseURI).href;
  return `${root}models/${path}.gltf`;
}

function load(path: string): Promise<THREE.Group> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(modelUrl(path)).then((gltf) => {
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      return gltf.scene;
    });
    cache.set(path, p);
  }
  return p;
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
}

/**
 * KayKit packs use different unit scales, so props are normalised here:
 * re-centred on their footprint and scaled to a real-world size.
 */
export async function spawnProp(path: string, opts: PropOptions = {}): Promise<Prop> {
  const model = (await load(path)).clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  let scale = 1;
  if (opts.height) scale = opts.height / size.y;
  else if (opts.width) scale = opts.width / Math.max(size.x, size.z);
  model.position.set(-centre.x, -box.min.y, -centre.z);
  const object = new THREE.Group();
  object.add(model);
  object.scale.setScalar(scale);
  return { object, size: size.multiplyScalar(scale) };
}
