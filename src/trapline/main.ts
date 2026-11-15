import * as THREE from 'three';
import { spawnProp } from '../shared/assets';
import { brand } from '../shared/brand';
import { hashString, mulberry32, nzDateKey, nzDateLabel } from '../shared/rng';
import {
  buildBird, buildBlossom, buildHex, buildNest, buildPredator, buildTrap, buildTunnel,
  SPECIES_COLOUR, SPECIES_NAME,
} from './models';
import { key, NIGHTS, Sim, SPECIES, type NightReport, type Species, type Tile, type Tool } from './sim';

// ---------------------------------------------------------------------------
// Layout: pointy-top hexes, 2 m across the flats (the KayKit tile size)
// ---------------------------------------------------------------------------
const HEX_SIZE = 2 / Math.sqrt(3);
const STEP_SECONDS = 0.6;
const BIRD_COLOURS = ['#2f6f73', '#8aa23b', '#b9895a', '#6a8f9c', '#7a5a3a'];

function tilePos(t: { q: number; r: number }): THREE.Vector3 {
  return new THREE.Vector3(2 * (t.q + t.r / 2), 0, 1.5 * HEX_SIZE * t.r);
}

function tileAt(x: number, z: number): { q: number; r: number } {
  const fq = ((Math.sqrt(3) / 3) * x - z / 3) / HEX_SIZE;
  const fr = ((2 / 3) * z) / HEX_SIZE;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(-fq - fr);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s + fq + fr);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const DAY_SKY = new THREE.Color('#9fdcff');
const NIGHT_SKY = new THREE.Color('#0d1a3a');
const scene = new THREE.Scene();
scene.background = DAY_SKY.clone();

const hemi = new THREE.HemisphereLight('#e6f6ff', '#5e8f4a', 1.1);
scene.add(hemi);
// The sun is in the north (top of the board, -Z), so shadows fall towards the player.
const sun = new THREE.DirectionalLight('#fff3d2', 2.1);
sun.position.set(-7, 16, -9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 45 });
sun.shadow.bias = -0.002;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(36, 1, 1, 200);
const BOARD_CENTRE = new THREE.Vector3(0, 0, 0.4);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Pull back until the whole block fits, whichever way the phone is held.
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const distance = Math.max(7.6 / Math.tan(hHalf), 9.5 / Math.tan(vHalf));
  const tilt = THREE.MathUtils.degToRad(56);
  camera.position.set(0, Math.sin(tilt) * distance, Math.cos(tilt) * distance + BOARD_CENTRE.z);
  camera.lookAt(BOARD_CENTRE);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const dateKey = nzDateKey();
const seed = params.get('seed') ?? dateKey;
/** ?reveal=1 shows every predator all night (for testing and for very young players). */
const revealAll = params.has('reveal');
const sim = new Sim(seed);
const decoRng = mulberry32(hashString(`trap-line-deco:${seed}`));

type Phase = 'loading' | 'evening' | 'night' | 'morning' | 'end';
let phase: Phase = 'loading';
let tool: Tool = 'trap';
let report: NightReport | null = null;
let nightClock = 0;
let nightSteps = 0;
let darkness = 0;

const gear = new Map<string, THREE.Group>();
const nests = new Map<string, THREE.Group>();
const birds: THREE.Group[] = [];
const critters = new Map<number, THREE.Group>();
const trails = new THREE.Group();
scene.add(trails);

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
async function buildBoard(): Promise<void> {
  const jobs: Promise<void>[] = [];
  const add = async (model: string, at: THREE.Vector3, opts: { width?: number; height?: number; rot?: number }) => {
    const prop = await spawnProp(model, opts);
    prop.object.position.copy(at);
    prop.object.rotation.y = opts.rot ?? 0;
    scene.add(prop.object);
  };
  const trees = ['forest/Tree_1_A_Color1', 'forest/Tree_1_B_Color1', 'forest/Tree_4_A_Color1', 'forest/Tree_2_A_Color1'];

  for (const t of sim.tiles.values()) {
    const at = tilePos(t);
    if (t.terrain === 'farm') {
      const hex = buildHex(HEX_SIZE, '#d8cf7a');
      hex.position.x = at.x;
      hex.position.z = at.z;
      scene.add(hex);
      jobs.push(add('hexagon/fence_wood_straight', at.clone().add(new THREE.Vector3(-0.55, 0, 0)), { width: 1.7 }));
      continue;
    }
    const base = t.terrain === 'water' ? 'hexagon/hex_water' : 'hexagon/hex_grass';
    jobs.push(
      spawnProp(base).then((prop) => {
        // Tiles are modelled with their top at y = 0, so undo the "rest on the ground" lift.
        prop.object.position.set(at.x, -prop.size.y, at.z);
        scene.add(prop.object);
      }),
    );
    if (t.terrain === 'bush') {
      // Trees sit at the back of the tile so gear and nests stay visible at the front.
      const count = 2 + Math.floor(decoRng() * 2);
      for (let i = 0; i < count; i++) {
        const offset = new THREE.Vector3((i - (count - 1) / 2) * 0.62 + (decoRng() - 0.5) * 0.2, 0, -0.5 + decoRng() * 0.25);
        jobs.push(add(trees[Math.floor(decoRng() * trees.length)], at.clone().add(offset), { height: 1.15 + decoRng() * 0.6, rot: decoRng() * 6.28 }));
      }
    } else if (t.terrain === 'pohutukawa') {
      const height = 2.1;
      const treeAt = at.clone().add(new THREE.Vector3(0, 0, -0.35));
      jobs.push(add('forest/Tree_2_A_Color1', treeAt, { height, rot: decoRng() * 6.28 }));
      const blossom = buildBlossom(1.7, height, decoRng);
      blossom.position.copy(treeAt);
      scene.add(blossom);
    } else if (t.terrain === 'bach') {
      jobs.push(add('hexagon/building_home_A_blue', at, { height: 1.9, rot: -0.6 }));
    }
    if (t.nest) {
      const nest = buildNest();
      nest.position.copy(at).add(new THREE.Vector3(0.25, 0, 0.5));
      scene.add(nest);
      nests.set(key(t.q, t.r), nest);
    }
  }
  await Promise.all(jobs);
}

function gearSpot(t: { q: number; r: number }): THREE.Vector3 {
  return tilePos(t).add(new THREE.Vector3(-0.2, 0, 0.42));
}

function syncGear(): void {
  for (const [k, mesh] of gear) {
    if (sim.toolAt(k)) continue;
    scene.remove(mesh);
    gear.delete(k);
  }
  for (const [set, build] of [[sim.traps, buildTrap], [sim.tunnels, buildTunnel]] as const) {
    for (const k of set) {
      if (gear.has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      const mesh = build();
      mesh.position.copy(gearSpot({ q, r }));
      mesh.rotation.y = 0.5;
      mesh.userData.pop = 0;
      scene.add(mesh);
      gear.set(k, mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const labels = el('labels');
const liveLabels: { node: HTMLElement; at: THREE.Vector3 }[] = [];

function addLabel(html: string, at: THREE.Vector3, tone: string): void {
  const node = document.createElement('div');
  node.className = `label ${tone}`;
  node.innerHTML = html;
  labels.appendChild(node);
  liveLabels.push({ node, at });
}

function clearLabels(): void {
  labels.replaceChildren();
  liveLabels.length = 0;
}

function chip(species: Species, count?: number): string {
  const n = count === undefined ? '' : ` ×${count}`;
  return `<span class="chip"><i style="background:${SPECIES_COLOUR[species]}"></i>${SPECIES_NAME[species]}${n}</span>`;
}

function refreshHud(): void {
  const sleeps = NIGHTS - sim.night;
  el('status').textContent =
    phase === 'morning'
      ? sleeps === 0 ? 'Christmas morning!' : `Morning ${sim.night} · ${sleeps} ${sleeps === 1 ? 'sleep' : 'sleeps'} to Christmas`
      : `Evening ${Math.min(sim.night + 1, NIGHTS)} of ${NIGHTS} · ${sleeps} ${sleeps === 1 ? 'sleep' : 'sleeps'} to Christmas`;
  el('birds').textContent = `🐦 ${sim.birds}`;
  for (const t of ['trap', 'tunnel'] as const) {
    const button = el<HTMLButtonElement>(`tool-${t}`);
    button.querySelector('b')!.textContent = String(sim.remaining(t));
    button.classList.toggle('active', tool === t);
  }
  el('evening').hidden = phase !== 'evening';
  el('morning').hidden = phase !== 'morning';
}

let toastTimer = 0;
function toast(text: string): void {
  const node = el('toast');
  node.textContent = text;
  node.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
function startEvening(): void {
  phase = 'evening';
  report = null;
  clearLabels();
  trails.clear();
  for (const b of birds) scene.remove(b);
  birds.length = 0;
  for (const nest of nests.values()) nest.getObjectByName('eggs')!.visible = true;
  for (const mesh of gear.values()) {
    const flag = mesh.getObjectByName('flag');
    if (flag) flag.visible = false;
  }
  refreshHud();
}

function startNight(): void {
  if (phase !== 'evening') return;
  report = sim.runNight();
  // sim.night has already advanced; show the night that is playing out.
  phase = 'night';
  nightClock = 0;
  nightSteps = Math.max(...report.predators.map((p) => p.steps.length - 1), 1);
  for (const p of report.predators) {
    if (critters.has(p.id)) continue;
    const mesh = buildPredator(p.species);
    mesh.visible = false;
    scene.add(mesh);
    critters.set(p.id, mesh);
  }
  el('hint').hidden = true;
  el('evening').hidden = true;
  el('status').textContent = `Night ${report.night} of ${NIGHTS}…`;
}

function nearTunnel(q: number, r: number): boolean {
  if (revealAll) return true;
  if (sim.tunnels.has(key(q, r))) return true;
  return sim.neighbours({ q, r }).some((n) => sim.tunnels.has(key(n.q, n.r)));
}

function updateNight(dt: number): void {
  if (!report) return;
  nightClock += dt;
  const t = Math.max(0, nightClock - 0.7) / STEP_SECONDS;
  for (const p of report.predators) {
    const mesh = critters.get(p.id)!;
    const last = p.steps.length - 1;
    const i = Math.min(Math.floor(t), last);
    const j = Math.min(i + 1, last);
    const f = Math.min(t - i, 1);
    const a = tilePos(p.steps[i]);
    const b = tilePos(p.steps[j]);
    mesh.position.lerpVectors(a, b, f * f * (3 - 2 * f));
    mesh.position.y = Math.abs(Math.sin(t * Math.PI * 2)) * 0.06;
    if (i !== j) mesh.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    const caughtNow = p.caughtAt !== null && t >= p.caughtAt;
    const here = f < 0.5 ? p.steps[i] : p.steps[j];
    mesh.visible = !caughtNow && nearTunnel(here.q, here.r);
    if (caughtNow) {
      const at = p.steps[p.caughtAt!];
      const flag = gear.get(key(at.q, at.r))?.getObjectByName('flag');
      if (flag) flag.visible = true;
    }
  }
  if (t >= nightSteps + 0.8) startMorning();
}

function startMorning(): void {
  if (!report) return;
  phase = 'morning';
  const r = report;
  for (const [id, mesh] of critters) {
    mesh.visible = false;
    if (!sim.predators.some((p) => p.id === id)) {
      scene.remove(mesh);
      critters.delete(id);
    }
  }
  // Failure should teach: show who raided each nest, and which way the trapped ones came.
  for (const [k, species] of r.raided) {
    const [q, rr] = k.split(',').map(Number);
    nests.get(k)!.getObjectByName('eggs')!.visible = false;
    addLabel(`✖ ${chip(species)}`, tilePos({ q, r: rr }).add(new THREE.Vector3(0.25, 0.5, 0.5)), 'bad');
  }
  let birdIndex = 0;
  for (const [k, nest] of nests) {
    if (r.raided.has(k)) continue;
    const bird = buildBird(BIRD_COLOURS[birdIndex++ % BIRD_COLOURS.length]);
    bird.position.copy(nest.position).add(new THREE.Vector3(0, 0.12, 0));
    bird.rotation.y = birdIndex * 1.3;
    bird.userData.phase = birdIndex;
    scene.add(bird);
    birds.push(bird);
  }
  for (const k of sim.tunnels) {
    const [q, rr] = k.split(',').map(Number);
    const seen = r.prints.get(k) ?? [];
    addLabel(seen.length ? `🐾 ${seen.map((s) => chip(s)).join('')}` : '🐾 none', gearSpot({ q, r: rr }).add(new THREE.Vector3(0, 0.5, 0)), 'info');
  }
  for (const p of r.predators) {
    if (p.caughtAt === null || p.caughtAt < 1) continue;
    const points = p.steps.slice(0, p.caughtAt + 1).map((s) => tilePos(s).setY(0.12));
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, points.length * 8, 0.05, 5),
      new THREE.MeshBasicMaterial({ color: SPECIES_COLOUR[p.species], transparent: true, opacity: 0.85 }),
    );
    trails.add(tube);
  }

  const caught = SPECIES.filter((s) => r.caught[s] > 0).map((s) => chip(s, r.caught[s])).join('') || 'nothing';
  el('morning-title').textContent = `Morning ${r.night}: ${r.nestsSafe} of ${r.nestsTotal} nests safe`;
  el('morning-body').innerHTML = `Trapped: ${caught}<br>+${r.birdsGained} birds fledged`;
  el<HTMLButtonElement>('next').textContent = sim.finished ? 'Christmas morning 🎄' : `Set up night ${r.night + 1}`;
  refreshHud();
}

function showEnd(): void {
  phase = 'end';
  clearLabels();
  const chorus = sim.chorus();
  const heard = chorus.filter((c) => c.here).length;
  el('end-title').textContent = heard === chorus.length ? 'A full dawn chorus!' : heard ? 'The birds are coming back' : 'A quiet Christmas morning';
  el('end-score').textContent = `${sim.birds} birds fledged`;
  el('end-chorus').innerHTML = chorus
    .map((c) => `<li class="${c.here ? 'here' : ''}">${c.here ? '🎶' : '·'} ${c.name}<small>${c.at} birds</small></li>`)
    .join('');
  const label = seed === dateKey ? nzDateLabel() : `#${seed}`;
  const grid = chorus.map((c) => (c.here ? '🐦' : '▫️')).join('');
  const shareText = `Trap Line 🪤 ${label}\n${grid} ${sim.birds} birds\n${brand.presenter} ${brand.campaign}`;
  const share = el<HTMLButtonElement>('share');
  share.onclick = async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ text: shareText, url });
      else {
        await navigator.clipboard.writeText(`${shareText}\n${url}`);
        share.textContent = 'Copied!';
      }
    } catch {
      // Share sheet dismissed.
    }
  };
  el('morning').hidden = true;
  el('hud').hidden = true;
  el('end').hidden = false;
}

// ---------------------------------------------------------------------------
// Input: tap a tile to place the selected gear, tap it again to pick it up
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down: { x: number; y: number } | null = null;

function tapTile(clientX: number, clientY: number): void {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!hit) return;
  const { q, r } = tileAt(hit.x, hit.z);
  const tile: Tile | undefined = sim.tiles.get(key(q, r));
  if (!tile) return;
  place(tile);
}

function place(tile: Tile): void {
  if (phase !== 'evening') return;
  const outcome = sim.toggle(tile, tool);
  if (outcome === 'none') {
    if (tile.nest) toast('Not on the nest: set it nearby');
    else if (!sim.canPlace(tile)) toast("Can't put gear there");
    else toast(`No ${tool === 'trap' ? 'traps' : 'tunnels'} left: tap one to move it`);
    return;
  }
  el('hint').hidden = true;
  syncGear();
  refreshHud();
}

canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tapTile(e.clientX, e.clientY);
  down = null;
});
for (const t of ['trap', 'tunnel'] as const) {
  el(`tool-${t}`).addEventListener('click', () => {
    tool = t;
    refreshHud();
  });
}
el('go').addEventListener('click', startNight);
el('next').addEventListener('click', () => (sim.finished ? showEnd() : startEvening()));
el('replay').addEventListener('click', () => location.reload());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const projected = new THREE.Vector3();
let elapsed = 0;

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (phase === 'night') updateNight(dt);

  // Day/night: lights and sky ease towards moonlight while the night plays out.
  const target = phase === 'night' ? 1 : 0;
  darkness += (target - darkness) * (1 - Math.exp(-dt * 3.5));
  (scene.background as THREE.Color).lerpColors(DAY_SKY, NIGHT_SKY, darkness);
  hemi.intensity = THREE.MathUtils.lerp(1.1, 0.5, darkness);
  hemi.color.set('#e6f6ff').lerp(new THREE.Color('#6f8fe0'), darkness);
  sun.intensity = THREE.MathUtils.lerp(2.1, 0.25, darkness);

  for (const mesh of gear.values()) {
    mesh.userData.pop = Math.min(1, (mesh.userData.pop as number) + dt * 6);
    const p = mesh.userData.pop as number;
    mesh.scale.setScalar(1.25 * (1 + Math.sin(p * Math.PI) * 0.25) * Math.min(1, p * 2));
  }
  for (const bird of birds) {
    bird.position.y = 0.12 + Math.abs(Math.sin(elapsed * 5 + (bird.userData.phase as number))) * 0.12;
  }
  for (const { node, at } of liveLabels) {
    projected.copy(at).project(camera);
    node.style.transform = `translate(-50%, -100%) translate(${((projected.x + 1) / 2) * window.innerWidth}px, ${((1 - projected.y) / 2) * window.innerHeight}px)`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  el('brand').textContent = `${brand.presenter} ${brand.campaign}`;
  requestAnimationFrame(frame);
  await buildBoard();
  el('loading').hidden = true;
  el('hud').hidden = false;
  el('hint').hidden = false;
  startEvening();
}
boot().catch((err) => {
  console.error(err);
  toast('Something went wrong loading the game');
});

// Debug/test surface.
declare global {
  interface Window {
    __trapline?: unknown;
  }
}
window.__trapline = {
  state: () => ({ phase, night: sim.night, birds: sim.birds, traps: [...sim.traps], tunnels: [...sim.tunnels], left: { trap: sim.remaining('trap'), tunnel: sim.remaining('tunnel') } }),
  tiles: () => [...sim.tiles.values()].map((t) => ({ ...t, canPlace: sim.canPlace(t), nearNest: sim.neighbours(t).some((n) => n.nest) })),
  screen: (q: number, r: number) => {
    const p = tilePos({ q, r }).project(camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  },
};
