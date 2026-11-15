import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { spawnProp, type Prop } from '../shared/assets';
import { brand } from '../shared/brand';
import { mulberry32, hashString, nzDateKey, nzDateLabel } from '../shared/rng';
import { buildCourse, FLICKS_PER_HOLE, type Hole } from './course';
import { buildChillyBin, buildJandal, JANDAL } from './models';
import { Hud, type HoleResult } from './ui';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const GRAVITY = 14;
const LAUNCH_HEIGHT = 0.75;
const LAUNCH_PITCH = (52 * Math.PI) / 180;
const SPEED_MIN = 4;
const SPEED_MAX = 12.5;
const MAX_YAW = (40 * Math.PI) / 180;
const FIXED_DT = 1 / 120;
const LANDING_MARGIN = 0.1;
const OUT_OF_BOUNDS = 16;
const IMPACT_KEEP_LINEAR = 0.3;
const IMPACT_KEEP_SPIN = 0.25;

type Phase = 'loading' | 'aim' | 'flight' | 'between' | 'done';
type Pose = 'sole-down' | 'strap-up' | 'edge';

interface Target {
  hole: Hole;
  object: THREE.Object3D;
  position: THREE.Vector3;
  rotation: number;
  halfX: number;
  halfZ: number;
  topY: number;
  marker: THREE.Group;
}

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd6ff');
scene.fog = new THREE.Fog('#8fd6ff', 22, 48);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 80);
const camPos = new THREE.Vector3(0, 2.3, 3);
const camLook = new THREE.Vector3(0, 0.5, -3);
const camPosGoal = camPos.clone();
const camLookGoal = camLook.clone();

scene.add(new THREE.HemisphereLight('#dff3ff', '#6faa4d', 1.15));
// In Aotearoa the midday sun sits in the north. North is +Z here (behind the player),
// so shadows fall away to the south and the targets are lit from the front.
const sun = new THREE.DirectionalLight('#fff4d6', 2.2);
sun.position.set(-5, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 12, bottom: -8, near: 1, far: 40 });
sun.shadow.bias = -0.0015;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(60, 40),
  new THREE.MeshLambertMaterial({ color: '#79c957' }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the horizontal view roughly constant so landscape screens don't zoom in.
  camera.fov = w > h ? 42 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
world.defaultContactMaterial.friction = 0.7;
world.defaultContactMaterial.restitution = 0.08;
(world.solver as CANNON.GSSolver).iterations = 14;

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const jandalMesh = buildJandal();
scene.add(jandalMesh);
const jandalBody = new CANNON.Body({
  mass: 0.25,
  shape: new CANNON.Box(new CANNON.Vec3(JANDAL.halfWidth, JANDAL.halfThickness, JANDAL.halfLength)),
  linearDamping: 0,
  angularDamping: 0,
});
jandalBody.type = CANNON.Body.KINEMATIC;
world.addBody(jandalBody);

// A rubber jandal lands with a dead slap rather than a bounce: the first impact of each
// flick soaks up most of the energy, which is what keeps a well-judged flick on the target.
let hasLanded = false;
jandalBody.addEventListener('collide', () => {
  if (hasLanded || phase !== 'flight') return;
  hasLanded = true;
  jandalBody.linearDamping = 0.25;
  jandalBody.angularDamping = 0.45;
  jandalBody.velocity.scale(IMPACT_KEEP_LINEAR, jandalBody.velocity);
  jandalBody.angularVelocity.scale(IMPACT_KEEP_SPIN, jandalBody.angularVelocity);
});

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const dateKey = nzDateKey();
const seed = params.get('seed') ?? dateKey;
const course = buildCourse(seed);
const targets: Target[] = [];
const hud = new Hud(brand, seed === dateKey ? nzDateLabel() : `#${seed}`);

function holePosition(hole: Hole): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(hole.angle) * hole.distance, 0, -Math.cos(hole.angle) * hole.distance);
}

function buildMarker(radius: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffe14a' });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 40), mat);
  ring.rotation.x = Math.PI / 2;
  ring.name = 'ring';
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 12), mat);
  arrow.rotation.x = Math.PI;
  arrow.name = 'arrow';
  group.add(ring, arrow);
  group.visible = false;
  return group;
}

async function buildTarget(hole: Hole): Promise<Target> {
  const { type } = hole;
  const prop: Prop = type.model.startsWith('proc:')
    ? buildChillyBin(type.width)
    : await spawnProp(type.model, { width: type.width });
  const position = holePosition(hole);
  prop.object.position.copy(position);
  prop.object.rotation.y = hole.rotation;
  scene.add(prop.object);

  const halfX = prop.size.x / 2;
  const halfZ = prop.size.z / 2;
  const topY = prop.size.y;
  if (!type.flat) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(halfX, topY / 2, halfZ)),
      position: new CANNON.Vec3(position.x, topY / 2, position.z),
    });
    body.quaternion.setFromEuler(0, hole.rotation, 0);
    world.addBody(body);
  }
  const marker = buildMarker(Math.min(halfX, halfZ) * 0.8);
  marker.position.set(position.x, topY + 0.03, position.z);
  scene.add(marker);
  return { hole, object: prop.object, position, rotation: hole.rotation, halfX, halfZ, topY, marker };
}

/** Backyard dressing. Kept outside the playable fan so it never blocks a flick. */
async function buildScenery(): Promise<void> {
  const rng = mulberry32(hashString(`scenery:${seed}`));
  const place = async (
    model: string,
    x: number,
    z: number,
    opts: { width?: number; height?: number; rot?: number } = {},
  ): Promise<Prop> => {
    const prop = await spawnProp(model, opts);
    prop.object.position.set(x, 0, z);
    prop.object.rotation.y = opts.rot ?? 0;
    scene.add(prop.object);
    return prop;
  };
  const jobs: Promise<unknown>[] = [];

  // Back fence, with bush and harakeke (flax) planting along it.
  for (let x = -13; x <= 13; x += 2.2) {
    jobs.push(place('hexagon/fence_wood_straight', x, -11.5, { width: 2.25, rot: Math.PI / 2 }));
  }
  const trees = ['forest/Tree_1_A_Color1', 'forest/Tree_2_A_Color1', 'forest/Tree_3_A_Color1'];
  for (let i = 0; i < 9; i++) {
    const x = -14 + i * 3.4 + rng() * 1.2;
    jobs.push(place(trees[i % trees.length], x, -13.5 - rng() * 2.5, { height: 4.5 + rng() * 2.5, rot: rng() * 6.28 }));
  }
  for (let i = 0; i < 7; i++) {
    const model = i % 2 ? 'forest/Bush_1_A_Color1' : 'mixedbag1/flax_flower_A';
    jobs.push(place(model, -11 + i * 3.6 + rng(), -10.6, { height: 0.9 + rng() * 0.5, rot: rng() * 6.28 }));
  }
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = 2.5 + rng() * 11;
    jobs.push(place('forest/Grass_1_A_Color1', Math.sin(a) * r, -Math.cos(a) * r * 0.8 - 1, { height: 0.22, rot: a }));
  }

  // The bach, the wagon, and the Christmas corner.
  jobs.push(place('hexagon/building_home_A_blue', -10.5, -15.5, { height: 6.5, rot: 0.5 }));
  jobs.push(place('city/car_stationwagon', 9.5, -8.5, { width: 4.2, rot: -0.5 }));
  jobs.push(place('holiday/christmas_tree_decorated', 7.2, -3.6, { height: 3 }));
  const presents = ['present_A_red', 'present_B_blue', 'present_C_green', 'present_D_yellow', 'present_E_white', 'present_sphere_A_red'];
  presents.forEach((p, i) => {
    const a = 1.2 + i * 0.75;
    jobs.push(place(`holiday/${p}`, 7.2 + Math.sin(a) * 1.5, -3.6 + Math.cos(a) * 1.5, { width: 0.55, rot: a }));
  });

  // Shade for the arvo.
  jobs.push(place('mixedbag1/umbrella_pink', -7, -4.5, { height: 2.7 }));
  jobs.push(place('furniture/chair_A_wood', -6.4, -3.6, { height: 0.95, rot: 2.3 }));
  jobs.push(place('city/bench', -8.2, -7.5, { width: 1.8, rot: 0.9 }));
  jobs.push(place('holiday/football', 6, -8.2, { width: 0.3 }));
  await Promise.all(jobs);
}

// ---------------------------------------------------------------------------
// Aim preview and confetti
// ---------------------------------------------------------------------------
const PREVIEW_DOTS = 12;
const previewDots = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
  PREVIEW_DOTS,
);
previewDots.visible = false;
previewDots.frustumCulled = false;
scene.add(previewDots);

const CONFETTI = 90;
const confettiGeo = new THREE.BufferGeometry();
const confettiPos = new Float32Array(CONFETTI * 3);
const confettiVel = new Float32Array(CONFETTI * 3);
const confettiCol = new Float32Array(CONFETTI * 3);
confettiGeo.setAttribute('position', new THREE.BufferAttribute(confettiPos, 3));
confettiGeo.setAttribute('color', new THREE.BufferAttribute(confettiCol, 3));
const confetti = new THREE.Points(
  confettiGeo,
  new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true }),
);
confetti.visible = false;
confetti.frustumCulled = false;
scene.add(confetti);
let confettiLife = 0;

function burstConfetti(at: THREE.Vector3): void {
  const colour = new THREE.Color();
  for (let i = 0; i < CONFETTI; i++) {
    confettiPos.set([at.x, at.y + 0.1, at.z], i * 3);
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 2.5;
    confettiVel.set([Math.cos(a) * s, 3 + Math.random() * 3.5, Math.sin(a) * s], i * 3);
    colour.set(brand.palette[i % brand.palette.length]);
    confettiCol.set([colour.r, colour.g, colour.b], i * 3);
  }
  confettiGeo.attributes.color.needsUpdate = true;
  confettiLife = 1.6;
  confetti.visible = true;
}

function updateConfetti(dt: number): void {
  if (confettiLife <= 0) return;
  confettiLife -= dt;
  for (let i = 0; i < CONFETTI; i++) {
    confettiVel[i * 3 + 1] -= 9 * dt;
    for (let k = 0; k < 3; k++) confettiPos[i * 3 + k] += confettiVel[i * 3 + k] * dt;
    if (confettiPos[i * 3 + 1] < 0.02) confettiPos[i * 3 + 1] = 0.02;
  }
  confettiGeo.attributes.position.needsUpdate = true;
  (confetti.material as THREE.PointsMaterial).opacity = Math.min(1, confettiLife * 2);
  if (confettiLife <= 0) confetti.visible = false;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let phase: Phase = 'loading';
let holeIndex = 0;
let flicksLeft = FLICKS_PER_HOLE;
let flightTime = 0;
let stillTime = 0;
let betweenTimer = 0;
let score = 0;
const results: HoleResult[] = [];

interface Shot {
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  yaw: number;
}

function currentTarget(): Target {
  return targets[holeIndex];
}

/** Turns a power (0..1) and a yaw offset from the target bearing into launch vectors. */
function computeShot(power: number, yawOffset: number): Shot {
  const target = currentTarget();
  const speed = SPEED_MIN + THREE.MathUtils.clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN);
  const yaw = target.hole.angle + THREE.MathUtils.clamp(yawOffset, -MAX_YAW, MAX_YAW);
  const dir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const velocity = dir.clone().multiplyScalar(Math.cos(LAUNCH_PITCH) * speed);
  velocity.y = Math.sin(LAUNCH_PITCH) * speed;
  // Landing assist: spin is set so the jandal completes exactly one flip by the time
  // it comes down to the height of the target. Get the distance right and it lands flat.
  const drop = LAUNCH_HEIGHT - (target.topY + JANDAL.halfThickness);
  const airTime = (velocity.y + Math.sqrt(Math.max(0, velocity.y ** 2 + 2 * GRAVITY * drop))) / GRAVITY;
  const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const spin = right.multiplyScalar((Math.PI * 2) / airTime);
  return { velocity, spin, yaw };
}

/** Power needed to carry exactly to the current target (used for tests and future hints). */
function solvePower(): number {
  const target = currentTarget();
  const d = target.hole.distance;
  const rise = target.topY + JANDAL.halfThickness - LAUNCH_HEIGHT;
  const cos = Math.cos(LAUNCH_PITCH);
  const speed = Math.sqrt((GRAVITY * d * d) / (2 * cos * cos * (d * Math.tan(LAUNCH_PITCH) - rise)));
  return (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
}

function holdJandal(yaw: number, pullBack = 0): void {
  jandalBody.type = CANNON.Body.KINEMATIC;
  jandalBody.velocity.setZero();
  jandalBody.angularVelocity.setZero();
  const back = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(pullBack * 0.5);
  jandalBody.position.set(back.x, LAUNCH_HEIGHT - pullBack * 0.15, back.z);
  jandalBody.quaternion.setFromEuler(-0.25 - pullBack * 0.5, -yaw, 0, 'YXZ');
}

function setCameraForHole(snap = false): void {
  const { hole } = currentTarget();
  const fwd = new THREE.Vector3(Math.sin(hole.angle), 0, -Math.cos(hole.angle));
  camPosGoal.copy(fwd).multiplyScalar(-3.1).setY(2.35);
  camLookGoal.copy(fwd).multiplyScalar(hole.distance * 0.6).setY(0.45);
  if (snap) {
    camPos.copy(camPosGoal);
    camLook.copy(camLookGoal);
  }
}

function startHole(index: number): void {
  holeIndex = index;
  flicksLeft = FLICKS_PER_HOLE;
  targets.forEach((t, i) => (t.marker.visible = i === index));
  setCameraForHole(index === 0);
  startAim();
}

function startAim(): void {
  phase = 'aim';
  holdJandal(currentTarget().hole.angle);
  setCameraForHole();
  hud.setHole(holeIndex, course.holes.length, currentTarget().hole.type.label, flicksLeft, score);
}

function flick(power: number, yawOffset: number): void {
  if (phase !== 'aim') return;
  const shot = computeShot(power, yawOffset);
  holdJandal(shot.yaw);
  jandalBody.type = CANNON.Body.DYNAMIC;
  jandalBody.velocity.set(shot.velocity.x, shot.velocity.y, shot.velocity.z);
  jandalBody.angularVelocity.set(shot.spin.x, shot.spin.y, shot.spin.z);
  jandalBody.wakeUp();
  flicksLeft--;
  flightTime = 0;
  stillTime = 0;
  hasLanded = false;
  // No drag in the air, so the flip finishes exactly when the jandal arrives.
  jandalBody.linearDamping = 0;
  jandalBody.angularDamping = 0;
  phase = 'flight';
  previewDots.visible = false;
  hud.hideHint();
  hud.setHole(holeIndex, course.holes.length, currentTarget().hole.type.label, flicksLeft, score);
}

function landingPose(): Pose {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(jandalMesh.quaternion);
  if (up.y > 0.7) return 'sole-down';
  if (up.y < -0.7) return 'strap-up';
  return 'edge';
}

function isOnTarget(target: Target): boolean {
  const p = jandalMesh.position;
  const local = p.clone().sub(target.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -target.rotation);
  const heightOk = p.y > target.topY - 0.06 && p.y < target.topY + 0.3;
  if (!heightOk) return false;
  if (target.hole.type.round) return Math.hypot(local.x, local.z) < target.halfX + LANDING_MARGIN;
  return Math.abs(local.x) < target.halfX + LANDING_MARGIN && Math.abs(local.z) < target.halfZ + LANDING_MARGIN;
}

function finishHole(result: HoleResult, points: number): void {
  results.push(result);
  score += points;
  targets[holeIndex].marker.visible = false;
  phase = 'between';
  betweenTimer = 1.5;
}

function resolveLanding(outOfBounds: boolean): void {
  const target = currentTarget();
  const onTarget = !outOfBounds && isOnTarget(target);
  const pose = landingPose();
  const used = FLICKS_PER_HOLE - flicksLeft;

  if (onTarget && pose !== 'strap-up') {
    const legend = pose === 'edge';
    burstConfetti(jandalMesh.position);
    hud.toast(legend ? 'On its edge?! LEGEND!' : used === 1 ? 'First flick! Choice!' : 'Sweet as!', 'good');
    finishHole(legend ? 'legend' : used === 1 ? 'ace' : 'landed', FLICKS_PER_HOLE + 1 - used + (legend ? 2 : 0));
    return;
  }
  hud.toast(
    outOfBounds ? 'A gull nicked your jandal!' : onTarget ? 'Strap-up! So close…' : 'Yeah, nah. Have another crack',
    'bad',
  );
  if (flicksLeft > 0) {
    phase = 'between';
    betweenTimer = 1.1;
  } else {
    finishHole('miss', 0);
  }
}

function advance(): void {
  const holeDone = results.length > holeIndex;
  if (!holeDone) {
    startAim();
  } else if (holeIndex + 1 < course.holes.length) {
    startHole(holeIndex + 1);
  } else {
    phase = 'done';
    jandalMesh.visible = false;
    hud.showEnd(results, score, seed, dateKey === seed);
  }
}

// ---------------------------------------------------------------------------
// Input: drag back anywhere and let go, slingshot style
// ---------------------------------------------------------------------------
let dragStart: { x: number; y: number; id: number } | null = null;
let aim = { power: 0, yaw: 0, valid: false };

function readAim(x: number, y: number): void {
  if (!dragStart) return;
  const dx = x - dragStart.x;
  const dy = y - dragStart.y;
  const full = Math.min(window.innerHeight * 0.36, 320);
  const length = Math.hypot(dx, dy);
  aim = {
    power: Math.min(1, length / full),
    yaw: THREE.MathUtils.clamp(Math.atan2(-dx, Math.max(dy, 1)), -MAX_YAW, MAX_YAW),
    valid: dy > 14 && length > 24,
  };
}

function updatePreview(): void {
  previewDots.visible = phase === 'aim' && aim.valid;
  if (!previewDots.visible) return;
  const shot = computeShot(aim.power, aim.yaw);
  holdJandal(shot.yaw, aim.power);
  const m = new THREE.Matrix4();
  for (let i = 0; i < PREVIEW_DOTS; i++) {
    const t = (i + 1) * 0.055;
    const s = 1 - i / (PREVIEW_DOTS * 1.4);
    m.makeScale(s, s, s).setPosition(
      shot.velocity.x * t,
      LAUNCH_HEIGHT + shot.velocity.y * t - 0.5 * GRAVITY * t * t,
      shot.velocity.z * t,
    );
    previewDots.setMatrixAt(i, m);
  }
  previewDots.instanceMatrix.needsUpdate = true;
}

canvas.addEventListener('pointerdown', (e) => {
  if (phase !== 'aim' || dragStart) return;
  dragStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  hud.hideHint();
  canvas.setPointerCapture(e.pointerId);
  aim = { power: 0, yaw: 0, valid: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragStart || e.pointerId !== dragStart.id) return;
  readAim(e.clientX, e.clientY);
  updatePreview();
});
function endDrag(e: PointerEvent, cancelled: boolean): void {
  if (!dragStart || e.pointerId !== dragStart.id) return;
  if (!cancelled) readAim(e.clientX, e.clientY);
  dragStart = null;
  previewDots.visible = false;
  if (!cancelled && aim.valid && phase === 'aim') flick(aim.power, aim.yaw);
  else if (phase === 'aim') holdJandal(currentTarget().hole.angle);
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;
let elapsed = 0;

function stepPhysics(dt: number): void {
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
      jandalMesh.position.set(p.x, p.y, p.z);
      jandalMesh.quaternion.set(
        jandalBody.quaternion.x,
        jandalBody.quaternion.y,
        jandalBody.quaternion.z,
        jandalBody.quaternion.w,
      );
      resolveLanding(out);
    }
  }
}

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (phase !== 'loading') stepPhysics(dt);

  jandalMesh.position.set(jandalBody.position.x, jandalBody.position.y, jandalBody.position.z);
  jandalMesh.quaternion.set(
    jandalBody.quaternion.x,
    jandalBody.quaternion.y,
    jandalBody.quaternion.z,
    jandalBody.quaternion.w,
  );

  if (phase === 'between') {
    betweenTimer -= dt;
    if (betweenTimer <= 0) advance();
  }

  // Camera eases between holes and leans towards the jandal while it's in the air.
  const look = camLookGoal.clone();
  if (phase === 'flight') look.lerp(jandalMesh.position, 0.45);
  const k = 1 - Math.exp(-dt * 4);
  camPos.lerp(camPosGoal, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  for (const t of targets) {
    if (!t.marker.visible) continue;
    const pulse = 1 + Math.sin(elapsed * 4) * 0.06;
    t.marker.getObjectByName('ring')!.scale.setScalar(pulse);
    t.marker.getObjectByName('arrow')!.position.y = 0.95 + Math.sin(elapsed * 3) * 0.12;
  }
  updateConfetti(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  requestAnimationFrame(frame);
  const [built] = await Promise.all([Promise.all(course.holes.map(buildTarget)), buildScenery()]);
  targets.push(...built);
  hud.ready();
  startHole(0);
}

hud.onReplay(() => location.reload());
boot().catch((err) => {
  console.error(err);
  hud.toast('Something went wrong loading the game', 'bad');
});

// Small debug/test surface: lets automated tests flick without synthesising drags.
declare global {
  interface Window {
    __jandal?: unknown;
  }
}
window.__jandal = {
  state: () => ({
    phase,
    holeIndex,
    flicksLeft,
    score,
    results: [...results],
    jandal: jandalMesh.position.toArray().map((v) => +v.toFixed(2)),
    pose: landingPose(),
    target: targets[holeIndex] && {
      id: targets[holeIndex].hole.type.id,
      at: targets[holeIndex].position.toArray().map((v) => +v.toFixed(2)),
      topY: +targets[holeIndex].topY.toFixed(2),
      half: [+targets[holeIndex].halfX.toFixed(2), +targets[holeIndex].halfZ.toFixed(2)],
    },
  }),
  solvePower,
  flick,
};
