import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Plain materials that look the same batch together even if they are separate objects (some
 * procedural props make a material per part). Node materials keep their identity.
 */
const canonical = new Map<string, THREE.Material>();
function materialFor(m: THREE.Material): THREE.Material {
  if ((m as { isNodeMaterial?: boolean }).isNodeMaterial) return m;
  const p = m as THREE.MeshLambertMaterial;
  const std = m as THREE.MeshStandardMaterial;
  const key = [m.type, p.color?.getHexString(), p.emissive?.getHexString(), std.emissiveIntensity ?? '', std.metalness ?? '', std.roughness ?? '', m.opacity, p.map?.uuid ?? '', m.side, p.vertexColors ? 1 : 0, p.flatShading ? 1 : 0, m.alphaTest, p.fog ? 1 : 0].join('|');
  let c = canonical.get(key);
  if (!c) canonical.set(key, (c = m));
  return c;
}

/**
 * Static batching. KayKit packs share one texture atlas per pack and our procedural props
 * share paint materials, so after the world is built, every static mesh with the same
 * material (and the same vertex layout and shadow flags) inside one grid cell is baked into a
 * single mesh. Cells keep their own bounds, so frustum culling still drops whole areas behind
 * the camera: this doubles as the 2D area culling from the plan.
 *
 * Skipped: instanced and skinned meshes, anything under an object with `userData.dynamic`
 * (floating boats, waterfall water, clouds), transparent materials (they need sorting), and
 * node materials that move vertices (`positionNode`).
 */
export function batchStatic(roots: THREE.Object3D[], cell = 48): { before: number; after: number } {
  const groups = new Map<string, THREE.Mesh[]>();
  let before = 0;
  const visit = (o: THREE.Object3D) => {
    if (o.userData.dynamic) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && mesh.visible) {
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : materialFor(mesh.material)) as THREE.Material & { positionNode?: unknown };
      if (!Array.isArray(mesh.material) && !m.transparent && !m.positionNode && !mesh.geometry.morphAttributes.position) {
        before++;
        const g = mesh.geometry;
        const attrs = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(',');
        mesh.updateWorldMatrix(true, false);
        g.computeBoundingSphere();
        const c = g.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
        const key = [m.uuid, attrs, g.index ? 'i' : 'n', mesh.castShadow ? 1 : 0, mesh.receiveShadow ? 1 : 0, mesh.renderOrder, Math.floor(c.x / cell), Math.floor(c.z / cell)].join('|');
        let list = groups.get(key);
        if (!list) groups.set(key, (list = []));
        list.push(mesh);
      }
    }
    for (const child of o.children) visit(child);
  };
  roots.forEach(visit);

  let after = before;
  const scene = roots[0].parent ?? roots[0];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // Mirrored props (negative scale) would come out inside out once baked.
      if (m.matrixWorld.determinant() < 0 && g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) {
          const t = idx[i + 1];
          idx[i + 1] = idx[i + 2];
          idx[i + 2] = t;
        }
      }
      g.morphAttributes = {};
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const first = list[0];
    const batch = new THREE.Mesh(merged, materialFor(first.material as THREE.Material));
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.name = `batch:${(first.material as THREE.Material).name || 'mat'}`;
    batch.matrixAutoUpdate = false;
    batch.updateMatrix();
    scene.add(batch);
    for (const m of list) m.removeFromParent();
    after -= list.length - 1;
  }
  return { before, after };
}

/**
 * Bakes a rigid group's meshes into one mesh per material, in the group's own space (for
 * things that move as a whole, like sheep). Returns the same group, now with fewer children.
 */
export function mergeParts(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = materialFor(m.material);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(m);
  });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(inv.clone().multiply(m.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = list.some((m) => m.castShadow);
    mesh.receiveShadow = list.some((m) => m.receiveShadow);
    for (const m of list) m.removeFromParent();
    group.add(mesh);
  }
  return group;
}
