import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import type { Character } from '../../character/character';
import { best, burst, controls, Countdown, disposeTree, helper, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Mine! You are the gull. Hold a finger on the sand to fly there; tap a bit of food near you
 * to swoop. Every picnicker keeps glancing back at their lunch: grab it while they're looking
 * away (green) and it's yours. Get caught (red) and you're shooed off empty-beaked.
 */
const TIME = 75;
const FLY_SPEED = 6.5;
const GRAB_RANGE = 2.4;
const AREA = { x: 11, z: 8 };

interface Food {
  name: string;
  value: number;
  object: THREE.Object3D;
  home: THREE.Vector3;
  owner: number;
  taken: boolean;
}

interface Picnicker {
  who: Character;
  at: THREE.Vector3;
  watching: boolean;
  timer: number;
  eye: THREE.Mesh;
}

type Phase = 'idle' | 'play' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;

  // -- The picnic: four rugs, each with a picnicker and their lunch ---------------------
  const rugSpots = [v3(-6, 0, -3), v3(-1, 0, 3.5), v3(4.5, 0, -2.5), v3(7.5, 0, 4)];
  const rugColours = ['#d7263d', '#27c4f5', '#ffd23f', '#3e8e4e'];
  for (const [i, at] of rugSpots.entries()) {
    const rug = mesh(new THREE.BoxGeometry(2.2, 0.03, 1.6), rugColours[i], at.x, 0.02, at.z);
    rug.rotation.y = (i - 1.5) * 0.25;
    root.add(rug, mesh(new THREE.BoxGeometry(2.2, 0.031, 0.3), '#fbfbf6', at.x, 0.02, at.z));
  }
  const people: Picnicker[] = await Promise.all(
    rugSpots.map(async (at, i) => {
      const who = await helper(ctx, i);
      who.root.position.set(at.x - 0.75, 0, at.z);
      who.play('Sit_Floor_Idle');
      const eye = mesh(new THREE.SphereGeometry(0.16, 12, 8), '#2f9e5a', at.x - 0.75, 2.1, at.z);
      (eye.material as THREE.Material) = new THREE.MeshBasicMaterial({ color: '#2f9e5a' });
      eye.visible = false; // only a game cue: hidden while nobody is playing
      root.add(eye);
      return { who, at, watching: false, timer: 0, eye };
    }),
  );

  const foodTemplates: { name: string; value: number; build: () => Promise<THREE.Object3D> }[] = [
    { name: 'hot chips', value: 2, build: async () => { const g = new THREE.Group(); g.add(mesh(new THREE.ConeGeometry(0.16, 0.3, 8), '#f4f0e6', 0, 0.15, 0)); for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), '#f2c03a', Math.sin(i) * 0.06, 0.32, Math.cos(i) * 0.06)); return g; } },
    { name: 'a snag in bread', value: 2, build: async () => new THREE.Group().add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.3), '#e8c48a', 0, 0.04, 0), mesh(new THREE.CapsuleGeometry(0.035, 0.26, 4, 6).rotateX(Math.PI / 2), '#8a3b2e', 0, 0.09, 0)) },
    { name: 'a burger', value: 3, build: async () => (await spawnProp('restaurant/food_burger', { width: 0.3 })).object },
    { name: 'the pav', value: 5, build: async () => new THREE.Group().add(mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.14, 14), '#fbfbf6', 0, 0.07, 0), mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), '#d7263d', 0.06, 0.16, 0), mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 8), '#7cb342', -0.06, 0.16, 0.04)) },
  ];
  const foods: Food[] = [];
  for (const [i, at] of rugSpots.entries()) {
    for (let k = 0; k < 2; k++) {
      const t = foodTemplates[(i + k * 2) % foodTemplates.length];
      const object = await t.build();
      const home = v3(at.x + 0.2 + k * 0.6, 0.04, at.z + (k ? 0.35 : -0.3));
      object.position.copy(home);
      root.add(object);
      foods.push({ name: t.name, value: t.value, object, home, owner: i, taken: false });
    }
  }

  // -- The gull ------------------------------------------------------------------------
  const gull = buildGull();
  root.add(gull);
  const feathers = burst(40, ['#ffffff', '#c9ced6'], 0.1);
  root.add(feathers.object);

  // -- State ------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let clock = new Countdown(TIME);
  let score = 0;
  let stolen: Food[] = [];
  let caught = 0;
  let target: THREE.Vector3 | null = null;
  let carrying: Food | null = null;
  let swoop = 0;
  let stunned = 0;
  let auto = false;
  let padSteering = false;
  let bound: ReturnType<typeof pointer> | null = null;
  const nest = v3(0, 0, -AREA.z - 2.5);
  let rng = mulberry32(hashString(`gull:${ctx.seed}`));

  const hud = () => {
    ui.subtitle(carrying ? `Got ${carrying.name}! Fly it back to the rocks` : 'Pinch food while they look away');
    ui.stats([{ label: 'Time', value: clock.label }, { label: 'Pinched', value: String(score) }]);
  };

  const tryGrab = (at: THREE.Vector3) => {
    if (phase !== 'play' || carrying || stunned > 0) return;
    const pos = v3(gull.position.x, 0, gull.position.z);
    const food = foods
      .filter((f) => !f.taken && f.object.position.distanceTo(at) < 1.4 && f.object.position.distanceTo(pos) < GRAB_RANGE)
      .sort((a, b) => a.object.position.distanceTo(pos) - b.object.position.distanceTo(pos))[0];
    if (!food) return;
    swoop = 0.6;
    const owner = people[food.owner];
    if (owner.watching) {
      caught++;
      stunned = 2.2;
      feathers.fire(gull.position.clone(), 0.7);
      owner.who.play('Waving', { then: () => owner.who.play('Sit_Floor_Idle') });
      ui.toast('Shoo! Caught red-beaked', 'bad');
      target = gull.position.clone().setY(0).add(v3(0, 0, -6));
      return;
    }
    food.taken = true;
    carrying = food;
    ui.toast(`Mine! ${food.name}`, 'good');
    hud();
  };

  const finish = () => {
    phase = 'done';
    const b = best('seagull', ctx.seed, score);
    ui.end(
      {
        title: score >= 14 ? 'Chief chip thief' : score >= 7 ? 'A well-fed gull' : 'Still peckish',
        score: `${score} pts`,
        grid: [...stolen.map((f) => ({ label: f.name, tone: 'good' as const })), ...Array.from({ length: caught }, () => ({ label: 'Shooed', tone: 'bad' as const }))],
        shareGrid: stolen.map(() => '🍟').join('') + '🪶'.repeat(caught),
        note: b > score ? `Best today: ${b} pts` : 'Watch the eye over each picnicker: green means they’re not looking.',
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  const reset = () => {
    for (const f of foods) {
      f.taken = false;
      f.object.position.copy(f.home);
      f.object.visible = true;
      if (f.object.parent !== root) root.add(f.object);
    }
    gull.position.set(0, 3, -AREA.z);
    carrying = null;
    target = null;
    stunned = 0;
    score = 0;
    caught = 0;
    stolen = [];
    rng = mulberry32(hashString(`gull:${ctx.seed}`));
    people.forEach((p, i) => {
      p.watching = false;
      p.timer = 1 + i * 0.9;
    });
  };

  const zone: GameZone = {
    start() {
      reset();
      clock = new Countdown(TIME);
      phase = 'play';
      ctx.player.character.root.visible = false;
      bound = pointer(ctx, {
        down: (p) => p.ground && (target = p.ground.clone()),
        move: (p) => p.ground && (target = p.ground.clone()),
        tap: (p) => p.ground && tryGrab(p.ground),
      });
      ui.hint(controls({
        touch: 'Hold on the sand to fly there. Tap food near you to swoop. Grab it while the eye is green, then fly it back to the rocks.',
        keyboard: 'Fly with the arrows or WASD, {Space} to swoop on food near you. Grab it while the eye is green, then fly it back to the rocks.',
        pad: 'Fly with the left stick, {A} to swoop on food near you. Grab it while the eye is green, then fly it back to the rocks.',
      }));
      hud();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ctx.player.character.root.visible = true;
    },
    update(dt, elapsed) {
      feathers.update(dt);
      gull.children[1].rotation.z = Math.sin(elapsed * 9) * 0.6;
      gull.children[2].rotation.z = -Math.sin(elapsed * 9) * 0.6;
      for (const p of people) p.eye.visible = phase === 'play';
      if (phase !== 'play') {
        // Idle: circle above the picnic.
        gull.position.set(Math.cos(elapsed * 0.5) * 5, 5, Math.sin(elapsed * 0.5) * 4);
        gull.rotation.y = -elapsed * 0.5;
        return;
      }
      if (clock.tick(dt)) return finish();

      // Picnickers glance at their lunch and away again.
      for (const p of people) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.watching = !p.watching;
          p.timer = p.watching ? 1.2 + rng() * 1.6 : 1.8 + rng() * 2.6;
          p.who.root.rotation.y = p.watching ? Math.PI / 2 : -Math.PI / 2 + (rng() - 0.5);
        }
        (p.eye.material as THREE.MeshBasicMaterial).color.set(p.watching ? '#c9354a' : '#2f9e5a');
        p.eye.scale.setScalar(p.watching ? 1.25 : 1);
      }

      if (auto && !target) {
        if (carrying) target = nest.clone();
        else {
          const free = foods.filter((f) => !f.taken && !people[f.owner].watching);
          const f = free.sort((a, b) => a.object.position.distanceTo(gull.position) - b.object.position.distanceTo(gull.position))[0];
          if (f) target = f.object.position.clone();
        }
      }

      // Keyboard/gamepad: the stick flies the gull (the chase camera looks along +Z, so screen
      // right is -X), A / Space swoops on the nearest food in reach.
      const stick = ctx.input.stick();
      if (!auto && stunned <= 0 && (stick.x || stick.y)) {
        target = v3(gull.position.x - stick.x * 3, 0, gull.position.z + stick.y * 3);
        padSteering = true;
      } else if (padSteering) {
        target = null;
        padSteering = false;
      }
      if (!auto && ctx.input.confirm()) {
        const here = v3(gull.position.x, 0, gull.position.z);
        const food = foods.filter((f) => !f.taken && f.object.position.distanceTo(here) < GRAB_RANGE).sort((a, b) => a.object.position.distanceTo(here) - b.object.position.distanceTo(here))[0];
        tryGrab(food ? food.object.position.clone() : here);
      }

      stunned = Math.max(0, stunned - dt);
      swoop = Math.max(0, swoop - dt);
      const height = carrying ? 3 : 2.4 - Math.sin((swoop / 0.6) * Math.PI) * 2;
      if (target) {
        const to = v3(target.x - gull.position.x, 0, target.z - gull.position.z);
        const d = to.length();
        if (d > 0.15) {
          to.setLength(Math.min(d, FLY_SPEED * (stunned > 0 ? 1.4 : 1) * dt));
          gull.position.add(to);
          gull.rotation.y = Math.atan2(to.x, to.z);
        } else if (auto) {
          if (!carrying) tryGrab(target);
          target = null;
        }
      }
      gull.position.x = THREE.MathUtils.clamp(gull.position.x, -AREA.x - 2, AREA.x + 2);
      gull.position.z = THREE.MathUtils.clamp(gull.position.z, nest.z, AREA.z + 2);
      gull.position.y += (height - gull.position.y) * Math.min(1, dt * 6);

      if (carrying) {
        carrying.object.position.copy(gull.position).add(v3(0, -0.25, 0));
        if (Math.hypot(gull.position.x - nest.x, gull.position.z - nest.z) < 2.2) {
          score += carrying.value;
          stolen.push(carrying);
          carrying.object.visible = false;
          ui.toast(`+${carrying.value}`, 'good');
          carrying = null;
          target = null;
          if (foods.every((f) => f.taken)) return finish();
        }
      }
      hud();
      // Chase camera, behind and above the gull, looking at the picnic.
      const cam = root.localToWorld(gull.position.clone().add(v3(0, 7, -9)));
      const look = root.localToWorld(gull.position.clone().lerp(v3(0, 0, 1), 0.4).setY(0.4));
      ctx.rig.shot(cam, look, 4, true);
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, score, caught, time: Math.round(clock.left), carrying: carrying?.name ?? null, gull: { x: +gull.position.x.toFixed(1), z: +gull.position.z.toFixed(1) } }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  // Rocks the gull takes its loot back to.
  for (let i = 0; i < 5; i++) root.add(mesh(new THREE.DodecahedronGeometry(0.5 + (i % 3) * 0.25, 0), '#7d8288', nest.x - 2 + i, 0.3, nest.z + (i % 2) * 0.6));
  reset();
  return zone;
}

/** Body, then the two wings as children 1 and 2. Black back, red spot on a yellow bill. */
function buildGull(): THREE.Group {
  const body = mesh(new THREE.SphereGeometry(0.28, 12, 10), '#fbfbf6');
  body.scale.set(0.8, 0.75, 1.6);
  const g = new THREE.Group().add(body);
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.15, 0.08, 0);
    pivot.add(mesh(new THREE.BoxGeometry(1.0, 0.04, 0.36), '#2a2d33', s * 0.5, 0, 0));
    g.add(pivot);
  }
  g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), '#fbfbf6', 0, 0.16, 0.38));
  g.add(mesh(new THREE.ConeGeometry(0.05, 0.22, 6).rotateX(Math.PI / 2), '#f2c03a', 0, 0.12, 0.6));
  g.add(mesh(new THREE.SphereGeometry(0.025, 6, 5), '#d7263d', 0, 0.09, 0.62));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), '#2a2d33', 0, 0.06, -0.45));
  return g;
}
