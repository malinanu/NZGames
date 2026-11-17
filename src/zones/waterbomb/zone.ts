import * as THREE from 'three';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import { best, burst, controls, disposeTree, frame, helper, mesh, padAim, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Water Bomb Boxing Day in the neighbour's back yard. Turn-based artillery over a hedge:
 * drag back and let go to lob a water bomb (like Jandal Flip), the wind (shown by the flag)
 * pushes it sideways. Soak the neighbour three times before they soak you three times.
 * The neighbour learns: each of their throws lands closer than the last.
 */
const GRAVITY = 9.8;
const PITCH = 38 * (Math.PI / 180);
const SPEED_MIN = 5;
const SPEED_MAX = 13;
const LAUNCH_Y = 1.5;
const SOAK_RADIUS = 1.15;
const HITS_TO_WIN = 3;
const NEIGHBOUR_LANE = 4.5;

type Phase = 'idle' | 'aim' | 'flight' | 'their-turn' | 'their-flight' | 'between' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const rng = mulberry32(hashString(`waterbomb:${ctx.seed}`));

  // -- The yard: our side (+Z), the hedge, their side (-Z) --------------------------------
  const hedge = new THREE.Group();
  for (let x = -6; x <= 6; x += 1.2) hedge.add(mesh(new THREE.IcosahedronGeometry(0.75, 1), x % 2.4 ? '#3f7f3a' : '#4a8c42', x, 0.65, -4));
  root.add(hedge);
  const pool = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.35, 24), '#27c4f5', -3.2, 0.18, 1.4);
  const poolWater = mesh(new THREE.CircleGeometry(1.1, 24), '#7fdcf5', -3.2, 0.36, 1.4);
  poolWater.rotation.x = -Math.PI / 2;
  const bucket = mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.32, 12), '#ff7a1a', -1.9, 0.16, 2.1);
  root.add(pool, poolWater, bucket);
  // Their paddling pool and a garden gnome to hide behind.
  root.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 24), '#ff4fa3', 3.2, 0.15, -9.5));
  // Wind flag on a pole in the middle.
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), '#e9e4d8', 6.4, 1.6, -4);
  const flag = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.02), '#d7263d', 6.85, 2.9, -4);
  flag.geometry.translate(0.45, 0, 0);
  flag.position.x = 6.4;
  root.add(pole, flag);

  const neighbour = await helper(ctx, 2);
  const balloon = mesh(new THREE.SphereGeometry(0.16, 12, 10), '#27c4f5');
  balloon.scale.y = 1.15;
  root.add(balloon);
  const splash = burst(90, ['#bdefff', '#7fdcf5', '#ffffff'], 0.12);
  root.add(splash.object);
  const ring = new THREE.Mesh(new THREE.RingGeometry(SOAK_RADIUS - 0.08, SOAK_RADIUS, 32), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 14);
  dots.frustumCulled = false;
  root.add(dots);

  // -- State -----------------------------------------------------------------------
  let phase: Phase = 'idle';
  let wind = 0;
  let mySoaked = 0;
  let theirSoaked = 0;
  let throws = 0;
  let theirMiss = 3;
  let target = v3();
  const meAt = v3(0, 0, 2.2);
  const vel = v3();
  let wait = 0;
  let auto = false;
  const log: ('hit' | 'miss' | 'soaked')[] = [];

  const hud = () => {
    ui.subtitle(phase === 'their-turn' || phase === 'their-flight' ? "The neighbour's throw…" : `Wind ${wind === 0 ? 'calm' : `${Math.abs(wind).toFixed(1)} ${wind > 0 ? '→' : '←'}`}`);
    ui.stats([{ label: 'You soaked', value: `${theirSoaked}/${HITS_TO_WIN}` }, { label: 'You dry', value: `${HITS_TO_WIN - mySoaked}/${HITS_TO_WIN}` }]);
  };
  const newWind = () => {
    wind = Math.round((rng() - 0.5) * 6) / 2;
    flag.rotation.y = wind >= 0 ? 0 : Math.PI;
    flag.scale.x = 0.4 + Math.min(1, Math.abs(wind) / 3);
  };
  const placeNeighbour = () => {
    const x = (rng() - 0.5) * 2 * NEIGHBOUR_LANE;
    target = v3(x, 0, -9 - rng() * 3);
    neighbour.root.position.copy(target);
    neighbour.root.rotation.y = 0;
    neighbour.play('Idle_B');
    ring.position.set(target.x, 0.03, target.z);
    ring.visible = true;
  };

  /** Launch velocity for a throw from `from` with power 0..1 and aim yaw (0 = straight at -Z). */
  const launch = (power: number, yaw: number, dir: 1 | -1) => {
    const speed = SPEED_MIN + THREE.MathUtils.clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN);
    return v3(Math.sin(yaw) * Math.cos(PITCH) * speed, Math.sin(PITCH) * speed, -dir * Math.cos(yaw) * Math.cos(PITCH) * speed);
  };
  /** Power and yaw that land on `to` from `from`, allowing for the wind. */
  const solve = (from: THREE.Vector3, to: THREE.Vector3, dir: 1 | -1) => {
    // Flight time depends on power; iterate a few times to cancel the wind drift.
    let aimX = to.x;
    let power = 0.5;
    let yaw = 0;
    for (let i = 0; i < 6; i++) {
      const dx = aimX - from.x;
      const dz = to.z - from.z;
      const d = Math.hypot(dx, dz);
      const c = Math.cos(PITCH);
      const speed = Math.sqrt((GRAVITY * d * d) / (2 * c * c * (d * Math.tan(PITCH) + LAUNCH_Y)));
      power = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
      yaw = Math.atan2(dx, -dir * dz);
      const vy = Math.sin(PITCH) * speed;
      const tFlight = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * LAUNCH_Y)) / GRAVITY;
      aimX = to.x - 0.5 * wind * tFlight * tFlight;
    }
    return { power, yaw };
  };

  const throwFrom = (from: THREE.Vector3, v: THREE.Vector3) => {
    balloon.position.copy(from).setY(LAUNCH_Y);
    vel.copy(v);
    balloon.visible = true;
  };

  const myThrow = (power: number, yaw: number) => {
    if (phase !== 'aim') return;
    dots.visible = false;
    throwFrom(meAt, launch(power, yaw, 1));
    ctx.player.character.play('Throw', { speed: 1.4 });
    phase = 'flight';
    throws++;
    ui.hint(null);
  };

  const land = (mine: boolean) => {
    balloon.visible = false;
    splash.fire(balloon.position.clone().setY(0.1), 0.6);
    const victim = mine ? target : meAt;
    const hit = balloon.position.clone().setY(0).distanceTo(v3(victim.x, 0, victim.z)) < SOAK_RADIUS;
    if (mine) {
      if (hit) {
        theirSoaked++;
        neighbour.play('Hit_A');
        ui.toast('Soaked them!', 'good');
      } else ui.toast('Splash! Missed.', 'info');
      log.push(hit ? 'hit' : 'miss');
    } else {
      if (hit) {
        mySoaked++;
        ctx.player.character.play('Hit_A');
        ui.toast("You're drenched!", 'bad');
        log.push('soaked');
      } else ui.toast('Ha! They missed.', 'good');
    }
    hud();
    phase = 'between';
    wait = 1.3;
    nextIsMine = !mine;
  };
  let nextIsMine = true;

  const theirTurn = () => {
    phase = 'their-turn';
    neighbour.root.rotation.y = 0;
    neighbour.play('Idle_A');
    hud();
    wait = 1.1;
  };
  const theirThrow = () => {
    // They aim at you, with an error that shrinks every throw (they're learning).
    const err = v3((rng() - 0.5) * 2, 0, (rng() - 0.5) * 2).setLength(0.5 + theirMiss * 0.85);
    theirMiss = Math.max(0, theirMiss - 1);
    const s = solve(target, meAt.clone().add(err), -1);
    throwFrom(target, launch(s.power, s.yaw, -1));
    neighbour.root.rotation.y = Math.PI;
    neighbour.play('Throw', { speed: 1.4 });
    phase = 'their-flight';
  };

  const myTurn = () => {
    if (theirSoaked >= HITS_TO_WIN || mySoaked >= HITS_TO_WIN) return finish();
    phase = 'aim';
    newWind();
    placeNeighbour();
    ctx.player.character.play('Idle_A');
    hud();
  };

  const finish = () => {
    phase = 'done';
    balloon.visible = false;
    ring.visible = false;
    const won = theirSoaked >= HITS_TO_WIN;
    const score = won ? Math.max(1, 10 - throws) : theirSoaked;
    const b = best('waterbomb', ctx.seed, score);
    if (won) ctx.player.character.play('Cheering');
    ui.end(
      {
        title: won ? 'Neighbours drenched!' : 'You got soaked',
        score: won ? `Won in ${throws} throws` : `${theirSoaked} of ${HITS_TO_WIN} soaks`,
        grid: log.map((l) => ({ label: l === 'hit' ? 'Soak' : l === 'miss' ? 'Miss' : 'Wet', tone: l === 'hit' ? 'great' : l === 'miss' ? 'neutral' : 'bad' })),
        shareGrid: log.map((l) => (l === 'hit' ? '💦' : l === 'miss' ? '⚪' : '🥶')).join(''),
        note: won && b !== score ? `Best today: ${10 - b} throws` : 'Watch the flag: the wind pushes the bomb sideways.',
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  // -- Input ---------------------------------------------------------------------
  let drag: { power: number; yaw: number; ok: boolean } = { power: 0, yaw: 0, ok: false };
  const read = (p: { x: number; y: number }, s: { x: number; y: number }) => {
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const len = Math.hypot(dx, dy);
    drag = { power: Math.min(1, len / Math.min(window.innerHeight * 0.36, 300)), yaw: THREE.MathUtils.clamp(Math.atan2(-dx, Math.max(dy, 1)), -0.7, 0.7), ok: dy > 14 && len > 24 };
  };
  const preview = () => {
    dots.visible = phase === 'aim' && drag.ok;
    if (!dots.visible) return;
    const v = launch(drag.power, drag.yaw, 1);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      const t = (i + 1) * 0.07;
      m.makeTranslation(meAt.x + v.x * t + 0.5 * wind * t * t, LAUNCH_Y + v.y * t - 0.5 * GRAVITY * t * t, meAt.z + v.z * t);
      dots.setMatrixAt(i, m);
    }
    dots.instanceMatrix.needsUpdate = true;
  };
  let bound: ReturnType<typeof pointer> | null = null;
  // Keyboard/gamepad: the stick or arrows set aim and power (kept between turns), A / Space lobs.
  const padAimer = padAim({ yawMax: 0.7 });

  const zone: GameZone = {
    start() {
      mySoaked = 0;
      theirSoaked = 0;
      throws = 0;
      theirMiss = 3;
      log.length = 0;
      ctx.player.place(meAt.clone().add(v3(0.4, 0, 0.2)), Math.PI);
      frame(ctx, v3(0, 4.8, 8.6), v3(0, 0.4, -6));
      bound = pointer(ctx, {
        move: (p, s) => {
          read(p, s);
          preview();
        },
        up: (p, s) => {
          read(p, s);
          dots.visible = false;
          if (drag.ok) myThrow(drag.power, drag.yaw);
        },
      });
      padAimer.reset();
      ui.hint(controls({
        touch: 'Drag back and let go to lob a water bomb. Land it in the yellow ring. Mind the wind!',
        keyboard: 'Aim with {←} {→}, power with {↑} {↓}, {Space} to lob. Land it in the yellow ring. Mind the wind!',
        pad: 'Aim and set the power with the left stick, {A} to lob. Land it in the yellow ring. Mind the wind!',
      }));
      myTurn();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      balloon.visible = false;
      dots.visible = false;
      ring.visible = false;
    },
    update(dt) {
      splash.update(dt);
      flag.rotation.z = Math.sin(performance.now() / 180) * 0.08;
      if (phase === 'flight' || phase === 'their-flight') {
        vel.y -= GRAVITY * dt;
        vel.x += wind * dt;
        balloon.position.addScaledVector(vel, dt);
        balloon.rotation.x += dt * 4;
        if (balloon.position.y <= 0.12) land(phase === 'flight');
        return;
      }
      if (phase === 'aim' && !auto) {
        if (padAimer.update(ctx, dt) || (padAimer.active && !dots.visible)) {
          drag = { power: padAimer.power, yaw: padAimer.yaw, ok: true };
          preview();
        }
        if (ctx.input.confirm()) myThrow(padAimer.power, padAimer.yaw);
      }
      if (phase === 'aim' && auto) {
        const s = solve(meAt, target.clone().add(v3((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2)), 1);
        myThrow(s.power, s.yaw);
      }
      if (phase === 'between' || phase === 'their-turn') {
        wait -= dt;
        if (wait > 0) return;
        if (phase === 'their-turn') return theirThrow();
        if (theirSoaked >= HITS_TO_WIN || mySoaked >= HITS_TO_WIN) return finish();
        nextIsMine ? myTurn() : theirTurn();
      }
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, throws, theirSoaked, mySoaked, wind, aim: { power: +padAimer.power.toFixed(2), yaw: +padAimer.yaw.toFixed(2) } }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  balloon.visible = false;
  ring.visible = false;
  dots.visible = false;
  neighbour.root.position.set(0, 0, -10);
  neighbour.play('Idle_B');
  return zone;
}
