import * as THREE from 'three';
import { scatter, spawnProp, type Placement } from '../shared/assets';
import { brand } from '../shared/brand';
import { hashString, mulberry32 } from '../shared/rng';
import { Colliders } from '../engine/colliders';
import { ZONES } from './zones';

/**
 * The town. Layout (north is -Z):
 *   north-west  the bach, its fenced backyard and the neighbour's yard
 *   north-east  the bush block
 *   centre      the village green and the Christmas tree
 *   middle      main street, running east-west, shops on both sides
 *   east        the lookout
 *   south       the dunes, the pōhutukawa-lined beach and the sea
 */
export interface WorldMap {
  colliders: Colliders;
  /** Animated bits (sea, blossom sway) the world ticks every frame. */
  update(dt: number, elapsed: number): void;
}

const STREET_Z = 14;
const SAND_Z = 29;
export const SEA_Z = 50;

const rng = mulberry32(hashString('kiwi-christmas-world'));
const rand = (a: number, b: number) => a + rng() * (b - a);

function inside(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

/** Areas kept clear of random scenery: paths, zones, buildings. */
function blocked(x: number, z: number): boolean {
  if (Math.abs(z - STREET_Z) < 9) return true; // street and shopfronts
  if (inside(x, z, -12, 12, -14, 10)) return true; // village green
  if (inside(x, z, -46, -16, -50, -10)) return true; // bach section
  if (Math.abs(x) < 3.5 && z < -8) return true; // track up to the bush
  for (const zone of ZONES) if (Math.hypot(x - zone.x, z - zone.z) < (zone.id === 'trap-line' ? 12 : 6)) return true;
  return false;
}

export async function buildWorld(scene: THREE.Scene): Promise<WorldMap> {
  const colliders = new Colliders();
  colliders.bounds = { minX: -62, maxX: 62, minZ: -62, maxZ: SEA_Z - 1.5 };
  const jobs: Promise<unknown>[] = [];
  const add = (p: Promise<THREE.Object3D>) => jobs.push(p.then((o) => scene.add(o)));

  // -- Ground --------------------------------------------------------------
  const ground = buildGround();
  scene.add(ground);
  const sea = buildSea();
  scene.add(sea.mesh);

  // -- Main street (City Builder Bits, 8 m tiles) -----------------------------
  const roadTiles: Placement[] = [];
  for (let x = -60; x <= 60; x += 8) roadTiles.push({ x, z: STREET_Z, rot: Math.PI / 2 });
  add(scatter('city/road_straight', { width: 8 }, roadTiles));
  add(scatter('city/road_junction', { width: 8 }, [{ x: 0, z: STREET_Z }]));
  // Footpaths either side.
  for (const side of [-1, 1]) {
    const path = new THREE.Mesh(new THREE.BoxGeometry(124, 0.12, 2.4), new THREE.MeshLambertMaterial({ color: '#d9d2c3' }));
    path.position.set(0, 0.06, STREET_Z + side * 5.2);
    path.receiveShadow = true;
    scene.add(path);
  }
  // Shops along the south side and the east half of the north side.
  const shopModels = ['building_A', 'building_B', 'building_E', 'building_F', 'building_C', 'building_D', 'building_G', 'building_H'];
  let shopIndex = 0;
  const shop = (x: number, z: number, rot: number) => {
    const model = shopModels[shopIndex++ % shopModels.length];
    add(spawnProp(`city/${model}_withoutBase`, { width: 8 }).then((p) => {
      p.object.position.set(x, 0, z);
      p.object.rotation.y = rot;
      return p.object;
    }));
    colliders.box(x, z, 7.6, 7.6, rot);
  };
  for (let x = -52; x <= 52; x += 8.5) {
    if (Math.abs(x - 10) < 6 || Math.abs(x + 24) < 5) continue; // gaps to walk down to the beach
    shop(x, STREET_Z + 11, Math.PI);
  }
  for (let x = 16; x <= 44; x += 8.5) shop(x, STREET_Z - 11, 0);
  // Streetlights, parked cars (drive on the left), benches and bins.
  const lights: Placement[] = [];
  for (let x = -56; x <= 56; x += 12) {
    lights.push({ x, z: STREET_Z - 4.3, rot: Math.PI / 2 }, { x: x + 6, z: STREET_Z + 4.3, rot: -Math.PI / 2 });
    colliders.circle(x, STREET_Z - 4.3, 0.25);
    colliders.circle(x + 6, STREET_Z + 4.3, 0.25);
  }
  add(scatter('city/streetlight', { height: 4.2 }, lights));
  const cars = ['car_sedan', 'car_hatchback', 'car_stationwagon', 'car_taxi', 'car_police'];
  const parked: [number, number, number][] = [[-44, STREET_Z - 2.6, Math.PI / 2], [-14, STREET_Z - 2.6, Math.PI / 2], [22, STREET_Z - 2.6, Math.PI / 2], [-30, STREET_Z + 2.6, -Math.PI / 2], [38, STREET_Z + 2.6, -Math.PI / 2], [6, STREET_Z + 2.6, -Math.PI / 2]];
  parked.forEach(([x, z, rot], i) => {
    add(spawnProp(`city/${cars[i % cars.length]}`, { width: 4.3 }).then((p) => {
      p.object.position.set(x, 0, z);
      p.object.rotation.y = rot;
      return p.object;
    }));
    colliders.box(x, z, 2, 4.3, rot);
  });

  // -- Village green ----------------------------------------------------------
  add(spawnProp('holiday/christmas_tree_decorated', { height: 7.5 }).then((p) => {
    p.object.position.set(0, 0, -6);
    return p.object;
  }));
  colliders.circle(0, -6, 2.2);
  const presents = ['present_A_red', 'present_B_blue', 'present_C_green', 'present_D_yellow', 'present_E_white', 'present_sphere_A_red', 'present_F_red', 'present_A_green'];
  presents.forEach((name, i) => {
    const a = (i / presents.length) * Math.PI * 2;
    add(spawnProp(`holiday/${name}`, { width: 0.8 + (i % 3) * 0.2 }).then((p) => {
      p.object.position.set(Math.sin(a) * 3.1, 0, -6 + Math.cos(a) * 3.1);
      p.object.rotation.y = a * 2;
      return p.object;
    }));
  });
  add(scatter('holiday/lantern', { height: 3.2 }, [{ x: -8, z: 6 }, { x: 8, z: 6 }, { x: -8, z: -12 }, { x: 8, z: -12 }]));
  for (const [x, z] of [[-8, 6], [8, 6], [-8, -12], [8, -12]]) colliders.circle(x, z, 0.35);
  add(scatter('city/bench', { width: 1.9 }, [{ x: -6, z: 0, rot: Math.PI / 2 }, { x: 6, z: 0, rot: -Math.PI / 2 }, { x: -3, z: 7.5 }, { x: 3, z: 7.5 }]));
  add(scatter('holiday/train_locomotive', { width: 2.2 }, [{ x: -10.5, z: -3, rot: 0.4 }]));
  scene.add(buildBillboard(new THREE.Vector3(-4.5, 0, -10.5), 0.35));
  scene.add(buildBillboard(new THREE.Vector3(14, 0, 33), Math.PI));
  colliders.box(-4.5, -10.5, 3.6, 0.4, 0.35);
  colliders.box(14, 33, 3.6, 0.4, Math.PI);

  // -- The bach and its section ---------------------------------------------------
  add(spawnProp('hexagon/building_home_A_blue', { height: 7.5 }).then((p) => {
    p.object.position.set(-31, 0, -21);
    p.object.rotation.y = Math.PI;
    return p.object;
  }));
  colliders.box(-31, -21, 7.2, 6.4);
  // Deck: furniture and the BBQ.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 4), new THREE.MeshLambertMaterial({ color: '#b98a5a' }));
  deck.position.set(-31, 0.12, -16);
  deck.receiveShadow = true;
  scene.add(deck);
  add(scatter('furniture/table_medium_long', { width: 2.6 }, [{ x: -26, z: -15.8 }]));
  add(scatter('furniture/chair_A_wood', { height: 1.1 }, [{ x: -27.4, z: -15.8, rot: Math.PI / 2 }, { x: -24.6, z: -15.8, rot: -Math.PI / 2 }]));
  add(scatter('restaurant/stove_single', { height: 1.2 }, [{ x: -22, z: -18.6 }]));
  add(scatter('restaurant/food_burger', { width: 0.5 }, [{ x: -26, z: -15.8, y: 1 }]));
  add(scatter('mixedbag1/umbrella_blue', { height: 3.1 }, [{ x: -36, z: -15.5 }]));
  colliders.box(-26, -15.8, 2.6, 1.2);
  // Backyard fence (Medieval Hexagon fences), with gaps on the south side.
  const fence: Placement[] = [];
  const fenceLine = (x0: number, z0: number, x1: number, z1: number, skip: (t: number) => boolean = () => false) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 2.2);
    const rot = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (skip(t)) continue;
      fence.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rot: rot + Math.PI / 2 });
    }
    colliders.box((x0 + x1) / 2, (z0 + z1) / 2, z0 === z1 ? len : 0.3, z0 === z1 ? 0.3 : len);
  };
  fenceLine(-45, -48, -15, -48);
  fenceLine(-45, -48, -45, -26);
  fenceLine(-15, -48, -15, -26);
  add(scatter('hexagon/fence_wood_straight', { width: 2.25 }, fence));
  // Harakeke (flax) and bush along the back fence.
  const flax: Placement[] = [];
  for (let x = -43; x <= -17; x += 3.2) flax.push({ x: x + rand(-0.4, 0.4), z: -46.6, rot: rand(0, 6.28), scale: rand(0.9, 1.3) });
  add(scatter('mixedbag1/flax_flower_A', { height: 1.3 }, flax));
  add(scatter('resource/Wood_Log_Stack', { width: 2 }, [{ x: -43, z: -28, rot: 1.2 }]));
  colliders.circle(-43, -28, 1);
  // Driveway: the family wagon and the Christmas load.
  add(spawnProp('city/car_stationwagon', { width: 4.4 }).then((p) => {
    p.object.position.set(-10, 0, -22);
    p.object.rotation.y = 0.15;
    return p.object;
  }));
  colliders.box(-10, -22, 2.1, 4.4, 0.15);
  add(scatter('resource/Pallet_Wood_Covered_A', { width: 1.6 }, [{ x: -6.2, z: -21 }]));
  add(scatter('holiday/present_C_green', { width: 0.7 }, [{ x: -6.2, z: -21, y: 0.3 }]));
  // Neighbour's yard to the west.
  add(spawnProp('hexagon/building_home_B_red', { height: 6.5 }).then((p) => {
    p.object.position.set(-54, 0, -38);
    p.object.rotation.y = Math.PI / 2;
    return p.object;
  }));
  colliders.box(-54, -38, 6, 6.4);

  // -- Bush block ---------------------------------------------------------------
  const forestTrees = ['forest/Tree_1_A_Color1', 'forest/Tree_2_A_Color1', 'forest/Tree_3_A_Color1', 'forest/Tree_4_A_Color1', 'forest/Tree_1_B_Color1', 'forest/Tree_2_B_Color1'];
  const treeSets = new Map<string, Placement[]>(forestTrees.map((t) => [t, []]));
  const plant = (x: number, z: number, height: number) => {
    if (blocked(x, z)) return;
    const model = forestTrees[Math.floor(rng() * forestTrees.length)];
    treeSets.get(model)!.push({ x, z, rot: rand(0, 6.28), scale: height / 5 });
    colliders.circle(x, z, 0.5 * (height / 5));
  };
  for (let i = 0; i < 150; i++) plant(rand(8, 62), rand(-62, -6), rand(4, 7.5));
  // A ring of trees closes the map in on the north, east and west.
  for (let x = -62; x <= 62; x += rand(4, 7)) plant(x, rand(-62, -56), rand(5, 8));
  for (let z = -56; z <= 4; z += rand(4, 7)) {
    plant(rand(56, 62), z, rand(5, 8));
    plant(rand(-62, -56), z, rand(5, 8));
  }
  for (const [model, places] of treeSets) add(scatter(model, { height: 5 }, places));
  const bushes: Placement[] = [];
  const rocks: Placement[] = [];
  const grass: Placement[] = [];
  for (let i = 0; i < 110; i++) {
    const x = rand(-60, 60);
    const z = rand(-60, SAND_Z - 2);
    if (blocked(x, z)) continue;
    bushes.push({ x, z, rot: rand(0, 6.28), scale: rand(0.7, 1.4) });
  }
  for (let i = 0; i < 24; i++) {
    const x = rand(10, 60);
    const z = rand(-60, -4);
    if (blocked(x, z)) continue;
    rocks.push({ x, z, rot: rand(0, 6.28), scale: rand(0.6, 1.6) });
    colliders.circle(x, z, 0.5 * rand(0.6, 1.6));
  }
  for (let i = 0; i < 380; i++) {
    const x = rand(-60, 60);
    const z = rand(-60, SAND_Z - 1);
    if (Math.abs(z - STREET_Z) < 7) continue;
    grass.push({ x, z, rot: rand(0, 6.28), scale: rand(0.7, 1.3) });
  }
  add(scatter('forest/Bush_1_A_Color1', { height: 1 }, bushes.filter((_, i) => i % 2 === 0)));
  add(scatter('forest/Bush_2_B_Color1', { height: 1.1 }, bushes.filter((_, i) => i % 2 === 1)));
  add(scatter('forest/Rock_1_A_Color1', { height: 1 }, rocks));
  add(scatter('forest/Grass_1_A_Color1', { height: 0.35 }, grass));

  // -- Lookout -------------------------------------------------------------------
  const hill = new THREE.Mesh(new THREE.CylinderGeometry(9, 13, 1.2, 28), new THREE.MeshLambertMaterial({ color: '#7cbf5a' }));
  hill.position.set(52, 0.2, 11);
  hill.receiveShadow = true;
  scene.add(hill);
  add(scatter('hexagon/building_tower_A_yellow', { height: 6 }, [{ x: 56, z: 11, rot: -Math.PI / 2 }]));
  colliders.circle(56, 11, 1.8);

  // -- Dunes, beach and pōhutukawa ------------------------------------------------
  const pohutukawa: Placement[] = [];
  for (let x = -58; x <= 58; x += rand(6, 10)) {
    const z = SAND_Z - rand(0, 2.5);
    if (Math.abs(x - 10) < 5 || Math.abs(x + 24) < 4) continue;
    pohutukawa.push({ x, z, rot: rand(0, 6.28), scale: rand(0.9, 1.25) });
    colliders.circle(x, z, 0.7);
  }
  add(scatter('forest/Tree_2_A_Color1', { height: 6 }, pohutukawa));
  scene.add(buildBlossom(pohutukawa, 6));
  add(scatter('mixedbag1/umbrella_pink', { height: 2.8 }, [{ x: -6, z: 40 }, { x: 24, z: 43 }]));
  add(scatter('mixedbag1/umbrella_yellow', { height: 2.8 }, [{ x: -36, z: 44 }, { x: 34, z: 38 }]));
  add(scatter('mixedbag1/umbrella_green', { height: 2.8 }, [{ x: 44, z: 45 }]));
  add(scatter('mixedbag1/waterbottle_A', { height: 0.4 }, [{ x: -12, z: 46 }, { x: 28, z: 47 }]));
  add(scatter('holiday/football', { width: 0.35 }, [{ x: 2, z: 36 }]));
  add(scatter('platformer/flag_A_red', { height: 2.6 }, [{ x: 4, z: 47.5 }]));
  add(scatter('platformer/flag_A_yellow', { height: 2.6 }, [{ x: 16, z: 47.5 }]));
  // Surf club hut.
  add(scatter('platformer/structure_C', { height: 3.2 }, [{ x: 10, z: 33 }]));
  colliders.box(10, 33, 3.4, 3.4);

  await Promise.all(jobs);
  return {
    colliders,
    update: (_dt, elapsed) => {
      sea.uniforms.uTime.value = elapsed;
    },
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildGround(): THREE.Mesh {
  // One big plane, vertex-coloured: grass, a darker bush floor, dunes and sand.
  const size = 300;
  const seg = 150;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const grass = new THREE.Color('#7fc35c');
  const grassDark = new THREE.Color('#5a9e45');
  const sand = new THREE.Color('#f1dcae');
  const wetSand = new THREE.Color('#d9bf8a');
  const dirt = new THREE.Color('#c9a77a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const noise = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + Math.sin(x * 0.05 + z * 0.07) * 0.5;
    c.copy(grass).lerp(grassDark, THREE.MathUtils.clamp(0.35 + noise * 0.35, 0, 1));
    if (x > 8 && z < -6) c.lerp(grassDark, 0.55); // bush floor
    const sandMix = THREE.MathUtils.smoothstep(z, SAND_Z - 3, SAND_Z + 1);
    c.lerp(sand, sandMix);
    c.lerp(wetSand, THREE.MathUtils.smoothstep(z, SEA_Z - 4, SEA_Z));
    // Dirt tracks: up to the bush, and from the street gaps down to the sand.
    const track = Math.max(
      z < -8 && z > -40 ? 1 - THREE.MathUtils.smoothstep(Math.abs(x), 1.2, 2.4) : 0,
      z > STREET_Z + 6 && z < SAND_Z + 1 ? 1 - THREE.MathUtils.smoothstep(Math.abs(x - 10), 1.4, 2.6) : 0,
      z > STREET_Z + 6 && z < SAND_Z + 1 ? 1 - THREE.MathUtils.smoothstep(Math.abs(x + 24), 1.2, 2.4) : 0,
    );
    c.lerp(dirt, track * 0.85);
    colours.set([c.r, c.g, c.b], i * 3);
    // Gentle dunes behind the beach; the walkable world itself stays flat.
    const dune = Math.exp(-(((z - (SAND_Z - 1)) / 2.2) ** 2)) * 0.25;
    const rim = Math.max(0, Math.max(Math.abs(x) - 64, -z - 64)) * 0.35;
    pos.setY(i, dune * (1 + Math.sin(x * 0.4) * 0.5) + Math.min(rim, 8) - (z > SEA_Z ? (z - SEA_Z) * 0.08 : 0));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildSea(): { mesh: THREE.Mesh; uniforms: { uTime: { value: number } } } {
  const uniforms = { uTime: { value: 0 } };
  const geo = new THREE.PlaneGeometry(400, 160, 120, 60);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, SEA_Z + 78);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uShore: { value: SEA_Z }, uDeep: { value: new THREE.Color('#0e6f9a') }, uShallow: { value: new THREE.Color('#3fc8c4') }, uFog: { value: new THREE.Color('#bfe9ff') } },
    transparent: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec3 p = position;
        float w = sin(p.x * 0.18 + uTime * 1.1) * 0.12 + sin(p.z * 0.35 - uTime * 1.6) * 0.1;
        p.y += w - 0.08;
        vWave = w;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uShore;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFog;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        float d = vWorld.z - uShore;
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 26.0, d));
        // Rolling foam lines coming up the beach.
        float roll = fract(d * 0.12 - uTime * 0.18 + sin(vWorld.x * 0.08) * 0.3);
        float foam = smoothstep(0.92, 1.0, roll) * (1.0 - smoothstep(4.0, 22.0, d));
        foam += 1.0 - smoothstep(0.0, 1.6, d + sin(vWorld.x * 0.3 + uTime) * 0.5);
        col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
        col += vWave * 0.25;
        float far = smoothstep(60.0, 150.0, d);
        col = mix(col, uFog, far);
        gl_FragColor = vec4(col, mix(0.88, 1.0, smoothstep(0.0, 4.0, d)));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

/** Crimson flower clusters for the pōhutukawa canopies (they are December-red). */
function buildBlossom(trees: Placement[], height: number): THREE.InstancedMesh {
  const perTree = 26;
  const geo = new THREE.IcosahedronGeometry(0.22, 0);
  const mat = new THREE.MeshLambertMaterial({ color: '#d7263d' });
  const mesh = new THREE.InstancedMesh(geo, mat, trees.length * perTree);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const t of trees) {
    const s = t.scale ?? 1;
    for (let k = 0; k < perTree; k++) {
      const a = rng() * Math.PI * 2;
      const up = 0.55 + rng() * 0.38;
      const r = 1.9 * s * (0.55 + rng() * 0.45) * (1.1 - up * 0.5);
      const sc = 0.7 + rng() * 0.9;
      m.makeScale(sc, sc, sc).setPosition(t.x + Math.cos(a) * r, height * s * up, t.z + Math.sin(a) * r);
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.castShadow = true;
  return mesh;
}

/** The only brand placement in the world: two "presented by" boards (see docs/compliance.md). */
function buildBillboard(at: THREE.Vector3, rot: number): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0, '#1b2440');
  grad.addColorStop(1, '#2b3a6b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);
  brand.palette.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(120 + i * 160, 440, 34, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '600 44px Nunito, system-ui, sans-serif';
  ctx.fillText('Kiwi Christmas Games', 512, 110);
  ctx.font = '700 104px Fredoka, system-ui, sans-serif';
  ctx.fillText(brand.presenter, 512, 250);
  ctx.font = '600 52px Fredoka, system-ui, sans-serif';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(brand.campaign, 512, 330);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 0.12), [
    ...Array(4).fill(new THREE.MeshLambertMaterial({ color: '#1b2440' })),
    new THREE.MeshBasicMaterial({ map: tex }),
    new THREE.MeshLambertMaterial({ color: '#1b2440' }),
  ]);
  board.position.y = 2.3;
  board.castShadow = true;
  const legMat = new THREE.MeshLambertMaterial({ color: '#7a5a3a' });
  for (const x of [-1.4, 1.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), legMat);
    leg.position.set(x, 0.8, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  g.add(board);
  g.position.copy(at);
  g.rotation.y = rot;
  return g;
}
