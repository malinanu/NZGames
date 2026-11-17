import * as THREE from 'three';
import { mergeParts } from './batch';
import { CHARACTERS, createCharacter, type AnimName, type Character } from '../character/character';
import { spawnProp } from '../shared/assets';
import { hashString, mulberry32 } from '../shared/rng';
import { box, cyl, group, paint, type Seat } from './build';
import type { WorldMap } from './map';
import { groundHeight, SEA_LEVEL, waterline } from './terrain';

/**
 * Everything that moves on its own: townsfolk on benches, towels and the wharf, strollers who
 * wave as you pass, cars on the main street, sheep on the farm and gulls over the bay.
 */
export interface Life {
  update(dt: number, elapsed: number, player: THREE.Vector3): void;
}

const rng = mulberry32(hashString('pohutukawa-bay-life'));
const rand = (a: number, b: number) => a + rng() * (b - a);

/** How far the sitting animations put the hips above the character's origin. */
const SIT_HIP = 0.52;
const ACTIVE_RANGE = 75;

const SEATED: Record<Seat['kind'], { anim: AnimName; drop: number }> = {
  bench: { anim: 'Sit_Chair_Idle', drop: SIT_HIP },
  chair: { anim: 'Sit_Chair_Idle', drop: SIT_HIP },
  towel: { anim: 'Lie_Idle', drop: 0 },
  ground: { anim: 'Sit_Floor_Idle', drop: 0 },
  fish: { anim: 'Fishing_Idle', drop: 0 },
  stand: { anim: 'Idle_B', drop: 0 },
  work: { anim: 'Digging', drop: 0 },
};

interface Walker {
  who: Character;
  path: THREE.Vector2[];
  loop: boolean;
  index: number;
  dir: 1 | -1;
  pause: number;
  waved: number;
}

export async function buildLife(scene: THREE.Scene, map: WorldMap, spare: Character[]): Promise<Life> {
  // -- Townsfolk --------------------------------------------------------------
  const wanted: Seat['kind'][] = ['bench', 'towel', 'fish', 'chair', 'bench', 'fish', 'towel', 'ground', 'work', 'bench', 'stand'];
  const walkerCount = map.walks.length;
  const need = wanted.length + walkerCount;
  const people = [...spare];
  const extras: Promise<Character>[] = [];
  for (let i = people.length; i < need; i++) extras.push(createCharacter(CHARACTERS[(i * 5 + 2) % CHARACTERS.length]));
  people.push(...(await Promise.all(extras)));
  const everyone: Character[] = [];

  for (const kind of wanted) {
    const seat = map.seats.find((s) => s.kind === kind && !s.taken);
    const who = people.shift();
    if (!seat || !who) continue;
    seat.taken = true;
    const pose = SEATED[kind];
    who.root.position.set(seat.x, seat.y - pose.drop, seat.z);
    who.root.rotation.y = seat.yaw;
    who.play(pose.anim);
    if (kind === 'fish') who.root.add(fishingRod());
    scene.add(who.root);
    everyone.push(who);
    if (kind !== 'bench' && kind !== 'chair') map.colliders.circle(seat.x, seat.z, 0.4);
  }

  const walkers: Walker[] = [];
  map.walks.forEach((path, i) => {
    const who = people.shift();
    if (!who) return;
    const loop = path.length > 2;
    const start = Math.floor(rng() * path.length);
    who.root.position.set(path[start].x, groundHeight(path[start].x, path[start].y), path[start].y);
    who.play('Walking_A');
    scene.add(who.root);
    everyone.push(who);
    walkers.push({ who, path, loop, index: start, dir: i % 2 ? -1 : 1, pause: 0, waved: 0 });
  });

  // -- Traffic: slow cars keeping left, which stop for anyone on the road -------------
  const carModels = ['city/car_sedan', 'city/car_hatchback', 'city/car_taxi'];
  const cars = await Promise.all(
    carModels.map(async (model, i) => {
      const prop = await spawnProp(model, { width: 4.2 });
      scene.add(prop.object);
      const lane = map.lanes[i % map.lanes.length];
      return { object: prop.object, lane, t: rng(), speed: rand(4.5, 6), halted: 0 };
    }),
  );

  // -- Sheep ------------------------------------------------------------------------
  const sheep = Array.from({ length: 14 }, () => {
    const mesh = buildSheep();
    const x = rand(-195, -72);
    const z = rand(-166, -78);
    mesh.position.set(x, groundHeight(x, z), z);
    mesh.rotation.y = rand(0, 6.28);
    scene.add(mesh);
    return { mesh, target: new THREE.Vector2(x, z), wait: rand(0, 6) };
  });

  // -- Gulls ------------------------------------------------------------------------
  const gulls = Array.from({ length: 9 }, (_, i) => {
    const mesh = buildGull();
    scene.add(mesh);
    const cx = rand(-120, 110);
    return { mesh, cx, cz: waterline(cx) + rand(-12, 40), r: rand(8, 22), h: rand(9, 20), speed: rand(0.25, 0.5) * (i % 2 ? 1 : -1), phase: rand(0, 6.28) };
  });

  const v = new THREE.Vector2();
  return {
    update(dt, elapsed, player) {
      for (const who of everyone) {
        const d = Math.hypot(who.root.position.x - player.x, who.root.position.z - player.z);
        who.root.visible = d < ACTIVE_RANGE * 1.8;
        if (d < ACTIVE_RANGE) who.update(dt);
      }

      for (const w of walkers) {
        const pos = w.who.root.position;
        const near = Math.hypot(pos.x - player.x, pos.z - player.z);
        w.waved = Math.max(0, w.waved - dt);
        if (w.pause > 0) {
          w.pause -= dt;
          if (w.pause <= 0) w.who.play('Walking_A');
          continue;
        }
        if (near < 3.2 && w.waved === 0) {
          // Stop, turn to the player and say hello.
          w.pause = 2.2;
          w.waved = 14;
          w.who.root.rotation.y = Math.atan2(player.x - pos.x, player.z - pos.z);
          w.who.play('Waving');
          continue;
        }
        const goal = w.path[w.index];
        v.set(goal.x - pos.x, goal.y - pos.z);
        const dist = v.length();
        if (dist < 0.4) {
          if (w.loop) w.index = (w.index + 1) % w.path.length;
          else {
            if (w.index + w.dir < 0 || w.index + w.dir >= w.path.length) w.dir = (w.dir * -1) as 1 | -1;
            w.index += w.dir;
          }
          continue;
        }
        v.multiplyScalar((1.5 * dt) / dist);
        pos.x += v.x;
        pos.z += v.y;
        pos.y = groundHeight(pos.x, pos.z);
        const yaw = Math.atan2(v.x, v.y);
        let turn = yaw - w.who.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        w.who.root.rotation.y += turn * Math.min(1, dt * 8);
      }

      for (const car of cars) {
        const { from, to } = car.lane;
        const length = from.distanceTo(to);
        const x = THREE.MathUtils.lerp(from.x, to.x, car.t);
        const dirX = Math.sign(to.x - from.x);
        // Give way: anything within a few metres ahead in this lane stops the car.
        const ahead = (player.x - x) * dirX;
        const blocked = ahead > -1 && ahead < 9 && Math.abs(player.z - from.z) < 2.6;
        car.halted = blocked ? 1 : Math.max(0, car.halted - dt * 0.8);
        car.t += ((car.speed * (1 - Math.min(1, car.halted))) / length) * dt;
        if (car.t > 1) car.t -= 1;
        car.object.position.set(x, groundHeight(x, from.z), from.z);
        car.object.rotation.y = dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
        // Ease in and out at the ends of the street so cars don't pop.
        const edge = Math.min(car.t, 1 - car.t) * length;
        car.object.scale.setScalar(Math.min(1, edge / 3) * (car.object.userData.base ?? (car.object.userData.base = car.object.scale.x)));
      }

      for (const s of sheep) {
        const pos = s.mesh.position;
        const away = Math.hypot(pos.x - player.x, pos.z - player.z);
        let speed = 0.7;
        if (away < 6) {
          // Shuffle off, away from the player.
          s.target.set(pos.x + ((pos.x - player.x) / away) * 7, pos.z + ((pos.z - player.z) / away) * 7);
          s.target.x = THREE.MathUtils.clamp(s.target.x, -197, -66);
          s.target.y = THREE.MathUtils.clamp(s.target.y, -168, -76);
          s.wait = 0;
          speed = 3.2;
        }
        s.wait -= dt;
        v.set(s.target.x - pos.x, s.target.y - pos.z);
        const dist = v.length();
        if (dist < 0.3) {
          if (s.wait < 0) {
            s.target.set(THREE.MathUtils.clamp(pos.x + rand(-9, 9), -197, -66), THREE.MathUtils.clamp(pos.z + rand(-9, 9), -168, -76));
            s.wait = rand(4, 12);
          }
        } else if (s.wait < 3 || speed > 1) {
          v.multiplyScalar((speed * dt) / dist);
          pos.x += v.x;
          pos.z += v.y;
          s.mesh.rotation.y = Math.atan2(v.x, v.y);
          pos.y = groundHeight(pos.x, pos.z) + Math.abs(Math.sin(elapsed * (speed > 1 ? 14 : 6) + pos.x)) * 0.05;
        }
      }

      for (const g of gulls) {
        const a = elapsed * g.speed + g.phase;
        g.mesh.position.set(g.cx + Math.cos(a) * g.r, Math.max(SEA_LEVEL + 4, g.h + Math.sin(a * 0.7) * 2), g.cz + Math.sin(a) * g.r);
        g.mesh.rotation.y = -a + (g.speed > 0 ? 0 : Math.PI);
        g.mesh.rotation.z = (g.speed > 0 ? -1 : 1) * 0.3;
        const flap = Math.sin(elapsed * 7 + g.phase) * 0.55;
        g.mesh.children[1].rotation.z = flap;
        g.mesh.children[2].rotation.z = -flap;
      }
    },
  };
}

function fishingRod(): THREE.Object3D {
  const rod = cyl(0.012, 0.02, 2.6, '#6b5038', 0, 0, 0, 6);
  rod.rotation.x = 1.05;
  rod.position.set(0.25, 1.35, 1.2);
  const line = box(0.006, 1.9, 0.006, '#f4f4ee', 0.25, 1.05, 2.32);
  return group(rod, line);
}

function buildSheep(): THREE.Group {
  const wool = paint('#f6f3ea');
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 1), wool);
  body.scale.set(0.85, 0.78, 1.25);
  body.position.y = 0.62;
  body.castShadow = true;
  const g = group(body, box(0.26, 0.3, 0.34, '#2e2a2a', 0, 0.78, 0.66));
  for (const [x, z] of [[-0.2, -0.32], [0.2, -0.32], [-0.2, 0.32], [0.2, 0.32]]) g.add(box(0.09, 0.36, 0.09, '#2e2a2a', x, 0.18, z));
  for (const s of [-1, 1]) g.add(box(0.14, 0.06, 0.08, '#2e2a2a', s * 0.18, 0.9, 0.6));
  // Rigid, so wool and the dark face/legs bake into two meshes (8 draws down to 2 per sheep).
  return mergeParts(g);
}

/** Body, then two wings as children 1 and 2 (the flap animation relies on that order). */
function buildGull(): THREE.Group {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), paint('#fbfbf6'));
  body.scale.set(0.7, 0.7, 2);
  const g = group(body);
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.add(box(0.8, 0.03, 0.26, s < 0 ? '#c9ced6' : '#c9ced6', s * 0.42, 0, 0));
    g.add(pivot);
  }
  g.add(box(0.05, 0.05, 0.14, '#f2a03a', 0, 0, 0.44));
  return g;
}
