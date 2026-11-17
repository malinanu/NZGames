import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { spawnProp, type Prop } from '../../shared/assets';
import { nzDateLabel } from '../../shared/rng';
import { burst, controls, padAim } from '../kit';
import type { GameZone, ZoneContext } from '../types';
import { buildCourse, FLICKS_PER_HOLE, HOLES_PER_COURSE, type Hole } from './course';
import { buildChillyBin, buildJandal, JANDAL } from './models';

/**
 * Jandal Flip, played in the bach's backyard. Everything here is in the zone's local space:
 * the player flicks from the origin towards -Z.
 */

const GRAVITY = 14;
const LAUNCH_HEIGHT = 0.75;
const LAUNCH_PITCH = (52 * Math.PI) / 180;
const SPEED_MIN = 4;
const SPEED_MAX = 12.5;
const MAX_YAW = (40 * Math.PI) / 180;
const FIXED_DT = 1 / 120;
const LANDING_MARGIN = 0.1;
const OUT_OF_BOUNDS = 13;
const IMPACT_KEEP_LINEAR = 0.3;
const IMPACT_KEEP_SPIN = 0.25;
const PREVIEW_DOTS = 12;

type Phase = 'idle' | 'aim' | 'flight' | 'between' | 'done';
type Pose = 'sole-down' | 'strap-up' | 'edge';
type HoleResult = 'ace' | 'landed' | 'legend' | 'miss';

interface Target {
  hole: Hole;
  position: THREE.Vector3;
  rotation: number;
  halfX: number;
  halfZ: number;
  topY: number;
  marker: THREE.Group;
}

const RESULT_PIP: Record<HoleResult, { label: string; tone: 'great' | 'good' | 'bad' }> = {
  ace: { label: 'First flick', tone: 'great' },
  landed: { label: 'Landed', tone: 'good' },
  legend: { label: 'Legend', tone: 'great' },
  miss: { label: 'Miss', tone: 'bad' },
};
const RESULT_EMOJI: Record<HoleResult, string> = { ace: '⭐', landed: '🩴', legend: '🤩', miss: '❌' };

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const course = buildCourse(ctx.seed);
  const label = ctx.daily ? nzDateLabel() : `#${ctx.seed}`;

  // -- Physics -------------------------------------------------------------
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
  world.defaultContactMaterial.friction = 0.7;
  world.defaultContactMaterial.restitution = 0.08;
  (world.solver as CANNON.GSSolver).iterations = 14;
  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  const d = ctx.player.character.def;
  const jandalMesh = buildJandal([d.jandals, '#1d2a6b', d.shirt]);
  root.add(jandalMesh);
  const jandalBody = new CANNON.Body({
    mass: 0.25,
    shape: new CANNON.Box(new CANNON.Vec3(JANDAL.halfWidth, JANDAL.halfThickness, JANDAL.halfLength)),
  });
  jandalBody.type = CANNON.Body.KINEMATIC;
  world.addBody(jandalBody);

  let phase: Phase = 'idle';
  let hasLanded = false;
  // A rubber jandal lands with a dead slap: the first impact soaks up most of the energy.
  jandalBody.addEventListener('collide', () => {
    if (hasLanded || phase !== 'flight') return;
    hasLanded = true;
    jandalBody.linearDamping = 0.25;
    jandalBody.angularDamping = 0.45;
    jandalBody.velocity.scale(IMPACT_KEEP_LINEAR, jandalBody.velocity);
    jandalBody.angularVelocity.scale(IMPACT_KEEP_SPIN, jandalBody.angularVelocity);
  });

  // -- Targets -------------------------------------------------------------
  const holePosition = (hole: Hole) => new THREE.Vector3(Math.sin(hole.angle) * hole.distance, 0, -Math.cos(hole.angle) * hole.distance);
  const buildMarker = (radius: number) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd23f' });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 40), mat);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'ring';
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 12), mat);
    arrow.rotation.x = Math.PI;
    arrow.name = 'arrow';
    group.add(ring, arrow);
    group.visible = false;
    return group;
  };
  const targets: Target[] = await Promise.all(
    course.holes.map(async (hole) => {
      const prop: Prop = hole.type.model.startsWith('proc:') ? buildChillyBin(hole.type.width) : await spawnProp(hole.type.model, { width: hole.type.width });
      const position = holePosition(hole);
      prop.object.position.copy(position);
      prop.object.rotation.y = hole.rotation;
      root.add(prop.object);
      const halfX = prop.size.x / 2;
      const halfZ = prop.size.z / 2;
      const topY = prop.size.y;
      if (!hole.type.flat) {
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(halfX, topY / 2, halfZ)), position: new CANNON.Vec3(position.x, topY / 2, position.z) });
        body.quaternion.setFromEuler(0, hole.rotation, 0);
        world.addBody(body);
      }
      const marker = buildMarker(Math.min(halfX, halfZ) * 0.8);
      marker.position.set(position.x, topY + 0.03, position.z);
      root.add(marker);
      return { hole, position, rotation: hole.rotation, halfX, halfZ, topY, marker };
    }),
  );
  // The launch mat.
  const mat = new THREE.Mesh(new THREE.CircleGeometry(0.75, 28), new THREE.MeshLambertMaterial({ color: '#f2d9a0' }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.012;
  mat.receiveShadow = true;
  root.add(mat);

  // -- Aim preview and confetti ---------------------------------------------
  const previewDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), PREVIEW_DOTS);
  // A dark shell behind each dot so the arc reads against grass, sky and sand alike.
  const previewOutline = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: '#17213f', side: THREE.BackSide }), PREVIEW_DOTS);
  previewOutline.frustumCulled = false;
  previewDots.add(previewOutline);
  previewDots.visible = false;
  previewDots.frustumCulled = false;
  root.add(previewDots);
  const confetti = burst(90);
  root.add(confetti.object);

  // -- State -----------------------------------------------------------------
  let holeIndex = 0;
  let flicksLeft = FLICKS_PER_HOLE;
  let flightTime = 0;
  let stillTime = 0;
  let betweenTimer = 0;
  let score = 0;
  let accumulator = 0;
  let results: HoleResult[] = [];
  const current = () => targets[holeIndex];

  const computeShot = (power: number, yawOffset: number) => {
    const target = current();
    const speed = SPEED_MIN + THREE.MathUtils.clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN);
    const yaw = target.hole.angle + THREE.MathUtils.clamp(yawOffset, -MAX_YAW, MAX_YAW);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const velocity = dir.clone().multiplyScalar(Math.cos(LAUNCH_PITCH) * speed);
    velocity.y = Math.sin(LAUNCH_PITCH) * speed;
    // Landing assist: one full flip timed to arrive at the target's height.
    const drop = LAUNCH_HEIGHT - (target.topY + JANDAL.halfThickness);
    const airTime = (velocity.y + Math.sqrt(Math.max(0, velocity.y ** 2 + 2 * GRAVITY * drop))) / GRAVITY;
    const spin = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar((Math.PI * 2) / airTime);
    return { velocity, spin, yaw };
  };
  const solvePower = () => {
    const target = current();
    const dist = target.hole.distance;
    const rise = target.topY + JANDAL.halfThickness - LAUNCH_HEIGHT;
    const cos = Math.cos(LAUNCH_PITCH);
    const speed = Math.sqrt((GRAVITY * dist * dist) / (2 * cos * cos * (dist * Math.tan(LAUNCH_PITCH) - rise)));
    return (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  };
  const holdJandal = (yaw: number, pullBack = 0) => {
    jandalBody.type = CANNON.Body.KINEMATIC;
    jandalBody.velocity.setZero();
    jandalBody.angularVelocity.setZero();
    const back = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(pullBack * 0.5);
    jandalBody.position.set(back.x, LAUNCH_HEIGHT - pullBack * 0.15, back.z);
    jandalBody.quaternion.setFromEuler(-0.25 - pullBack * 0.5, -yaw, 0, 'YXZ');
  };
  const restJandal = () => {
    jandalBody.type = CANNON.Body.KINEMATIC;
    jandalBody.position.set(0.15, JANDAL.halfThickness + 0.02, 0.05);
    jandalBody.quaternion.setFromEuler(0, 0.4, 0);
  };
  const syncMesh = () => {
    jandalMesh.position.set(jandalBody.position.x, jandalBody.position.y, jandalBody.position.z);
    jandalMesh.quaternion.set(jandalBody.quaternion.x, jandalBody.quaternion.y, jandalBody.quaternion.z, jandalBody.quaternion.w);
  };
  const toWorld = (v: THREE.Vector3) => root.localToWorld(v.clone());
  const camGoal = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const setCameraForHole = () => {
    const { hole } = current();
    const fwd = new THREE.Vector3(Math.sin(hole.angle), 0, -Math.cos(hole.angle));
    camGoal.pos.copy(fwd).multiplyScalar(-4.6).setY(3.3);
    camGoal.look.copy(fwd).multiplyScalar(hole.distance * 0.55).setY(0.3);
    ctx.rig.shot(toWorld(camGoal.pos), toWorld(camGoal.look), 3.2, true);
  };
  const refreshHud = () => {
    ui.subtitle(`Hole ${holeIndex + 1} of ${HOLES_PER_COURSE} · ${current().hole.type.label}`);
    ui.stats([
      { label: 'Flicks', value: `${flicksLeft}/${FLICKS_PER_HOLE}` },
      { label: 'Points', value: String(score) },
    ]);
  };
  const placePlayer = (yaw: number) => {
    // Stand ahead and to the left of the launch spot, out of the line of the flick, facing down the course.
    const side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(-2.7);
    const back = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-2.4);
    ctx.player.place(side.add(back), Math.PI - yaw);
  };

  const startHole = (index: number) => {
    holeIndex = index;
    padAimer.reset();
    flicksLeft = FLICKS_PER_HOLE;
    targets.forEach((t, i) => (t.marker.visible = i === index));
    startAim();
  };
  const startAim = () => {
    phase = 'aim';
    holdJandal(current().hole.angle);
    // Keyboard/gamepad aim carries over between flicks at the same hole, so it can be refined.
    if (padAimer.active) {
      aim = { power: padAimer.power, yaw: padAimer.yaw, valid: true };
      updatePreview();
    }
    placePlayer(current().hole.angle);
    ctx.player.character.play('Idle_A');
    setCameraForHole();
    refreshHud();
  };
  const flick = (power: number, yawOffset: number) => {
    if (phase !== 'aim') return;
    const shot = computeShot(power, yawOffset);
    holdJandal(shot.yaw);
    jandalBody.type = CANNON.Body.DYNAMIC;
    jandalBody.linearDamping = 0;
    jandalBody.angularDamping = 0;
    jandalBody.velocity.set(shot.velocity.x, shot.velocity.y, shot.velocity.z);
    jandalBody.angularVelocity.set(shot.spin.x, shot.spin.y, shot.spin.z);
    jandalBody.wakeUp();
    flicksLeft--;
    flightTime = 0;
    stillTime = 0;
    hasLanded = false;
    phase = 'flight';
    previewDots.visible = false;
    ui.hint(null);
    ctx.player.character.play('Throw', { speed: 1.4, then: () => ctx.player.character.play('Idle_A') });
    refreshHud();
  };
  const landingPose = (): Pose => {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(jandalMesh.quaternion);
    if (up.y > 0.7) return 'sole-down';
    if (up.y < -0.7) return 'strap-up';
    return 'edge';
  };
  const isOnTarget = (target: Target) => {
    const p = jandalMesh.position;
    const local = p.clone().sub(target.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -target.rotation);
    if (!(p.y > target.topY - 0.06 && p.y < target.topY + 0.3)) return false;
    if (target.hole.type.round) return Math.hypot(local.x, local.z) < target.halfX + LANDING_MARGIN;
    return Math.abs(local.x) < target.halfX + LANDING_MARGIN && Math.abs(local.z) < target.halfZ + LANDING_MARGIN;
  };
  const finishHole = (result: HoleResult, points: number) => {
    results.push(result);
    score += points;
    current().marker.visible = false;
    phase = 'between';
    betweenTimer = 1.5;
  };
  const resolveLanding = (outOfBounds: boolean) => {
    const onTarget = !outOfBounds && isOnTarget(current());
    const pose = landingPose();
    const used = FLICKS_PER_HOLE - flicksLeft;
    if (onTarget && pose !== 'strap-up') {
      const legend = pose === 'edge';
      confetti.fire(jandalMesh.position.clone());
      ctx.player.character.play('Cheering');
      ui.toast(legend ? 'On its edge?! Legend!' : used === 1 ? 'First flick! Choice!' : 'Sweet as!', 'good');
      finishHole(legend ? 'legend' : used === 1 ? 'ace' : 'landed', FLICKS_PER_HOLE + 1 - used + (legend ? 2 : 0));
      return;
    }
    ctx.player.character.play('Hit_A');
    ui.toast(outOfBounds ? 'Over the fence! Gone.' : onTarget ? 'Strap-up! So close…' : 'Yeah, nah. Have another crack', 'bad');
    if (flicksLeft > 0) {
      phase = 'between';
      betweenTimer = 1.1;
    } else finishHole('miss', 0);
  };
  const end = () => {
    phase = 'done';
    jandalMesh.visible = false;
    let best = score;
    if (ctx.daily) {
      try {
        const key = `jandal-flip:${ctx.seed}`;
        best = Math.max(Number(localStorage.getItem(key) ?? 0), score);
        localStorage.setItem(key, String(best));
      } catch {
        // Storage blocked: no saved best.
      }
    }
    ui.end(
      {
        title: score >= 12 ? 'Jandal royalty' : score >= 7 ? 'Sweet as' : 'Have another crack',
        score: `${score} pts`,
        grid: results.map((r) => RESULT_PIP[r]),
        shareGrid: results.map((r) => RESULT_EMOJI[r]).join(''),
        note: best > score ? `Your best today: ${best} pts` : ctx.daily ? 'A new course every day.' : '',
      },
      `Jandal of the Day ${label}`,
    );
  };
  const advance = () => {
    if (results.length <= holeIndex) startAim();
    else if (holeIndex + 1 < targets.length) startHole(holeIndex + 1);
    else end();
  };

  // -- Input: drag back anywhere and let go (touch, mouse) ------------------------
  // Keyboard/gamepad: the stick or arrows set aim and power, A / Space flicks.
  const padAimer = padAim({ yawMax: MAX_YAW });
  let dragStart: { x: number; y: number; id: number } | null = null;
  let aim = { power: 0, yaw: 0, valid: false };
  const readAim = (x: number, y: number) => {
    if (!dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    const full = Math.min(window.innerHeight * 0.36, 320);
    const length = Math.hypot(dx, dy);
    aim = { power: Math.min(1, length / full), yaw: THREE.MathUtils.clamp(Math.atan2(-dx, Math.max(dy, 1)), -MAX_YAW, MAX_YAW), valid: dy > 14 && length > 24 };
  };
  const updatePreview = () => {
    previewDots.visible = phase === 'aim' && aim.valid;
    if (!previewDots.visible) return;
    const shot = computeShot(aim.power, aim.yaw);
    holdJandal(shot.yaw, aim.power);
    const m = new THREE.Matrix4();
    for (let i = 0; i < PREVIEW_DOTS; i++) {
      const t = (i + 1) * 0.055;
      const s = 1 - i / (PREVIEW_DOTS * 1.4);
      m.makeScale(s, s, s).setPosition(shot.velocity.x * t, LAUNCH_HEIGHT + shot.velocity.y * t - 0.5 * GRAVITY * t * t, shot.velocity.z * t);
      previewDots.setMatrixAt(i, m);
      previewOutline.setMatrixAt(i, m);
    }
    previewDots.instanceMatrix.needsUpdate = true;
    previewOutline.instanceMatrix.needsUpdate = true;
  };
  const onDown = (e: PointerEvent) => {
    if (phase !== 'aim' || dragStart) return;
    dragStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    ctx.canvas.setPointerCapture(e.pointerId);
    aim = { power: 0, yaw: 0, valid: false };
    ui.hint(null);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragStart || e.pointerId !== dragStart.id) return;
    readAim(e.clientX, e.clientY);
    updatePreview();
  };
  const onUp = (e: PointerEvent, cancelled = false) => {
    if (!dragStart || e.pointerId !== dragStart.id) return;
    if (!cancelled) readAim(e.clientX, e.clientY);
    dragStart = null;
    previewDots.visible = false;
    if (!cancelled && aim.valid && phase === 'aim') flick(aim.power, aim.yaw);
    else if (phase === 'aim') holdJandal(current().hole.angle);
  };
  const onCancel = (e: PointerEvent) => onUp(e, true);

  restJandal();
  syncMesh();

  const zone: GameZone = {
    start() {
      results = [];
      score = 0;
      accumulator = 0;
      jandalMesh.visible = true;
      ctx.canvas.addEventListener('pointerdown', onDown);
      ctx.canvas.addEventListener('pointermove', onMove);
      ctx.canvas.addEventListener('pointerup', onUp);
      ctx.canvas.addEventListener('pointercancel', onCancel);
      ui.hint(controls({
        touch: 'Drag back anywhere and let go. Land it sole-down on the yellow ring.',
        keyboard: 'Aim with {←} {→}, power with {↑} {↓}, {Space} to flick. Land it sole-down on the yellow ring.',
        pad: 'Aim and set the power with the left stick, {A} to flick. Land it sole-down on the yellow ring.',
      }));
      startHole(0);
    },
    stop() {
      ctx.canvas.removeEventListener('pointerdown', onDown);
      ctx.canvas.removeEventListener('pointermove', onMove);
      ctx.canvas.removeEventListener('pointerup', onUp);
      ctx.canvas.removeEventListener('pointercancel', onCancel);
      dragStart = null;
      phase = 'idle';
      targets.forEach((t) => (t.marker.visible = false));
      previewDots.visible = false;
      jandalMesh.visible = true;
      restJandal();
      syncMesh();
    },
    update(dt, elapsed) {
      if (phase === 'aim' && !dragStart) {
        if (padAimer.update(ctx, dt)) {
          aim = { power: padAimer.power, yaw: padAimer.yaw, valid: true };
          updatePreview();
        }
        if (ctx.input.confirm()) flick(padAimer.power, padAimer.yaw);
      }
      if (phase === 'flight' || phase === 'between') {
        accumulator += dt;
        while (accumulator >= FIXED_DT) {
          world.step(FIXED_DT);
          accumulator -= FIXED_DT;
          if (phase !== 'flight') continue;
          flightTime += FIXED_DT;
          const p = jandalBody.position;
          const slow = jandalBody.velocity.length() < 0.12 && jandalBody.angularVelocity.length() < 0.3;
          stillTime = slow ? stillTime + FIXED_DT : 0;
          const out = Math.hypot(p.x, p.z) > OUT_OF_BOUNDS;
          if (out || flightTime > 7 || (flightTime > 0.3 && stillTime > 0.35)) {
            syncMesh();
            resolveLanding(out);
          }
        }
      }
      syncMesh();
      if (phase === 'between') {
        betweenTimer -= dt;
        if (betweenTimer <= 0) advance();
      }
      if (phase === 'flight') {
        // Lean the camera towards the jandal while it's in the air.
        const look = toWorld(camGoal.look).lerp(toWorld(jandalMesh.position), 0.45);
        ctx.rig.shot(toWorld(camGoal.pos), look, 4, true);
      }
      for (const t of targets) {
        if (!t.marker.visible) continue;
        t.marker.getObjectByName('ring')!.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.06);
        t.marker.getObjectByName('arrow')!.position.y = 0.95 + Math.sin(elapsed * 3) * 0.12;
      }
      confetti.update(dt);
    },
    dispose() {
      zone.stop();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
    },
    debug: {
      state: () => ({ phase, holeIndex, flicksLeft, score, results: [...results], pose: landingPose(), aim: { power: +padAimer.power.toFixed(2), yaw: +padAimer.yaw.toFixed(2) } }),
      solvePower,
      flick,
    },
  };
  return zone;
}
