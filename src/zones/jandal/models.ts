import * as THREE from 'three';
import type { Prop } from '../../shared/assets';

/** Jandal dimensions in metres (a bit oversized so it reads on a phone). */
export const JANDAL = { halfWidth: 0.11, halfThickness: 0.028, halfLength: 0.26 };

/** Local axes: +Y is the footbed side (sole-down = +Y pointing up), toe towards -Z. */
/** `colours` = [footbed, sole, strap]. */
export function buildJandal(colours: [string, string, string] = ['#27c4f5', '#1d2a6b', '#d7263d']): THREE.Group {
  const [footbed, sole, strap] = colours;
  const { halfWidth: w, halfThickness: t, halfLength: l } = JANDAL;

  const outline = new THREE.Shape();
  outline.absellipse(0, 0, w, l, 0, Math.PI * 2);
  const slab = (depth: number, colour: string) => {
    const geo = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 20 });
    geo.rotateX(Math.PI / 2); // extrude downwards along -Y
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8 }));
    mesh.castShadow = true;
    return mesh;
  };
  const group = new THREE.Group();
  const top = slab(t, footbed);
  top.position.y = t;
  const bottom = slab(t, sole);
  group.add(top, bottom);

  const strapMat = new THREE.MeshStandardMaterial({ color: strap, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, t, -l * 0.55),
      new THREE.Vector3(side * w * 0.45, t + 0.07, -l * 0.25),
      new THREE.Vector3(side * w * 0.85, t, l * 0.15),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.014, 6), strapMat);
    tube.castShadow = true;
    group.add(tube);
  }
  return group;
}

/** A proper Kiwi chilly bin: there isn't one in the asset packs. */
export function buildChillyBin(width: number): Prop {
  const depth = width * 0.58;
  const height = width * 0.6;
  const lid = height * 0.16;
  const object = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.96, height - lid, depth * 0.96),
    new THREE.MeshStandardMaterial({ color: '#1e73d8', roughness: 0.7 }),
  );
  body.position.y = (height - lid) / 2;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width, lid, depth),
    new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 0.6 }),
  );
  top.position.y = height - lid / 2;
  for (const m of [body, top]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  object.add(body, top);
  return { object, size: new THREE.Vector3(width, height, depth) };
}
