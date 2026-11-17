// Latin plus Latin Extended: the extended set carries the macrons (ā ē ī ō ū) te reo needs.
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-ext-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-ext-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-ext-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-ext-700.css';
import './world.css';
import * as THREE from 'three';
import { App } from '../engine/app';
import { CameraRig } from '../engine/cameraRig';
import { Input } from '../engine/input';
import { CHARACTERS, createCharacter, type Character } from '../character/character';
import { PlayerController } from '../character/controller';
import { brand } from '../shared/brand';
import { nzDateKey } from '../shared/rng';
import { Ambience } from './audio';
import { DayCycle } from './sky';
import { installFog, skyMaterial, world as gpu } from '../engine/tsl';
import { quality } from '../engine/quality';
import type { Place } from './build';
import { buildCollect, type Collect } from './collect';
import { buildLife, type Life } from './life';
import { buildWorld, STREET_Z, type WorldMap } from './map';
import { biomeAt, groundHeight, waterline } from './terrain';
import { ZoneManager } from './zoneManager';
import { SPAWN } from './zones';
import { icon } from './icons';

const STORE_KEY = 'kiwi-christmas:character';
const VISITED_KEY = 'kiwi-christmas:visited';
const params = new URLSearchParams(location.search);
const dateKey = nzDateKey();
const seed = params.get('seed') ?? dateKey;

const app = new App(document.getElementById('game') as HTMLCanvasElement);
const { scene, camera } = app;
const rig = new CameraRig(camera);
const input = new Input(app.canvas);
const ambience = new Ambience();
// ?debug exposes the scene for automated checks (never linked from anywhere).
if (params.has('debug')) (window as unknown as { __debug?: unknown }).__debug = { scene: app.scene, camera: app.camera, THREE };

// ---------------------------------------------------------------------------
// Sky and light: a TSL sky dome, one sun on a circular path, Day/Dusk/Night/Dawn presets
// (see sky.ts) and fog measured from the player rather than the camera (see engine/tsl.ts).
// ---------------------------------------------------------------------------
const sky = new THREE.Mesh(new THREE.SphereGeometry(560, 24, 12), skyMaterial());
sky.renderOrder = -1;
scene.add(sky);
installFog(scene);

const hemi = new THREE.HemisphereLight('#eaf7ff', '#6e9a52', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
const SHADOW_HALF = 38;
const SHADOW_MAP = quality.preset.shadowMap;
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 180 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
// ?time=0..1 jumps the cycle (0 midday, 0.42 dusk, 0.6 night, 0.8 dawn) for checks and screenshots.
const startTime = Number(params.get('time'));
const day = new DayCycle(sun, hemi, Number.isFinite(startTime) && params.has('time') ? startTime : 0.08);
if (params.has('time')) day.length = 1e9;
const setNight = (amount: number) => (day.forcedNight = amount > 0 ? amount : null);

/** Soft blob under each character so they read as standing on the ground even in shade. */
function contactShadow(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------------------
// UI shell
// ---------------------------------------------------------------------------
const loading = document.getElementById('loading')!;
const loadingBar = loading.querySelector<HTMLElement>('.loading-bar span')!;
const hud = document.createElement('div');
hud.className = 'world-hud';
hud.hidden = true;
hud.innerHTML = `
  <button class="icon-btn" data-map aria-label="Map and notebook">${icon('map')}<span class="badge" hidden></span></button>
  <div class="hud-title"><b data-place>Pōhutukawa Bay</b><span>Presented by ${brand.presenter} ${brand.campaign}</span></div>
  <div class="hud-right">
    <button class="icon-btn" data-sound aria-label="Sound on or off" aria-pressed="false">${icon('sound')}</button>
    <button class="icon-btn" data-who aria-label="Change character">${icon('user')}</button>
  </div>`;
document.body.appendChild(hud);
const placeLabel = hud.querySelector<HTMLElement>('[data-place]')!;
const help = document.createElement('div');
help.className = 'walk-help';
help.hidden = true;
help.innerHTML = `<span class="only-touch">Drag on the left to walk · drag on the right to look</span><span class="only-mouse">WASD to walk · Q/R to look · Space to jump · E to play</span>`;
document.body.appendChild(help);
const mapEl = document.createElement('div');
mapEl.className = 'map-sheet';
mapEl.hidden = true;
document.body.appendChild(mapEl);
const note = document.createElement('div');
note.className = 'note';
note.setAttribute('role', 'status');
document.body.appendChild(note);
let noteTimer = 0;
function showNote(title: string, body: string): void {
  note.innerHTML = `<b>${title}</b><span>${body}</span>`;
  note.classList.add('show');
  ambience.chime();
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => note.classList.remove('show'), 5200);
}

let progress = 0;
function setProgress(p: number): void {
  progress = Math.max(progress, p);
  loadingBar.style.transform = `scaleX(${progress})`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let player: PlayerController;
let zones: ZoneManager;
let world: WorldMap;
let life: Life | null = null;
let collect: Collect | null = null;
let mode: 'select' | 'walk' | 'zone' = 'select';
const playerShadow = contactShadow();
const visited = new Set<string>();
try {
  for (const id of JSON.parse(localStorage.getItem(VISITED_KEY) ?? '[]') as string[]) visited.add(id);
} catch {
  // No saved places.
}

const SELECT_AT = new THREE.Vector3(30, 0, 5);

async function boot(): Promise<void> {
  await app.init();
  app.start();
  setProgress(0.08);
  const worldPromise = buildWorld(scene).then((w) => {
    setProgress(0.6);
    return w;
  });
  const cast = await Promise.all(CHARACTERS.map((def) => createCharacter(def)));
  setProgress(0.75);
  world = await worldPromise;
  setProgress(1);
  if (import.meta.env.DEV) for (const problem of world.audit()) console.warn(`[grounding] ${problem}`);

  SELECT_AT.y = groundHeight(SELECT_AT.x, SELECT_AT.z);
  const lineup = new THREE.Group();
  cast.forEach((c, i) => {
    c.root.position.set(SELECT_AT.x + (i - (cast.length - 1) / 2) * 1.35, SELECT_AT.y, SELECT_AT.z);
    c.play(i % 2 ? 'Idle_B' : 'Idle_A');
    lineup.add(c.root);
  });
  scene.add(lineup);
  const castTick = app.onUpdate((dt) => cast.forEach((c) => c.update(dt)));

  window.setTimeout(() => loading.classList.add('done'), 150);
  window.setTimeout(() => (loading.hidden = true), 700);

  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  const chosen = await chooseCharacter(cast, saved);
  castTick();
  await startWalking(cast, chosen);
}

// ---------------------------------------------------------------------------
// Character select: the six stand on the green, the camera faces them
// ---------------------------------------------------------------------------
function chooseCharacter(cast: Character[], saved: string | null): Promise<number> {
  mode = 'select';
  input.enabled = false;
  let index = Math.max(0, CHARACTERS.findIndex((c) => c.id === saved));
  const head = document.createElement('div');
  head.className = 'select-head';
  head.innerHTML = `<h1>Kia ora! Who's off to the bay?</h1><p>Pick a character, then go for a wander. Step into a yellow ring to play a game.</p>`;
  document.body.appendChild(head);
  const panel = document.createElement('div');
  panel.className = 'select';
  panel.innerHTML = `
    <div class="select-cards" role="radiogroup" aria-label="Characters">
      ${CHARACTERS.map((c, i) => `
        <button class="char-card" role="radio" data-i="${i}" style="--shirt:${c.shirt};--trim:${c.trim}">
          <span class="swatch" aria-hidden="true"></span>
          <b>${c.name}</b><small>${c.tagline}</small>
        </button>`).join('')}
    </div>
    <button class="btn btn-primary btn-start">${icon('walk')}<span>Let's go</span></button>
    <p class="presented">Presented by ${brand.presenter} ${brand.campaign}</p>`;
  document.body.appendChild(panel);
  const cards = [...panel.querySelectorAll<HTMLButtonElement>('.char-card')];
  const select = (i: number) => {
    index = i;
    cards.forEach((c, k) => {
      c.setAttribute('aria-checked', String(k === i));
      c.tabIndex = k === i ? 0 : -1;
    });
    cast.forEach((c, k) => {
      c.root.position.z = SELECT_AT.z + (k === i ? 0.8 : 0);
      if (k === i) c.play('Waving', { then: () => c.play('Idle_A') });
      else if (c.animation === 'Waving') c.play('Idle_A');
    });
    cards[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // Frame the chosen one; on a wide screen the whole line-up fits anyway.
    const x = (cast[i].root.position.x - SELECT_AT.x) * (camera.aspect < 1 ? 1 : 0.25);
    rig.shot(new THREE.Vector3(SELECT_AT.x + x * 0.85, SELECT_AT.y + 2.0, SELECT_AT.z + 7.2), new THREE.Vector3(SELECT_AT.x + x, SELECT_AT.y + 1.15, SELECT_AT.z + 0.3), 3);
  };
  cards.forEach((c, i) => c.addEventListener('click', () => select(i)));
  panel.querySelector('.select-cards')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const n = (index + (k === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length;
      select(n);
      cards[n].focus();
    }
  });
  select(index);
  rig.snap();
  return new Promise((resolve) => {
    const go = () => {
      panel.classList.add('leaving');
      head.remove();
      window.setTimeout(() => panel.remove(), 260);
      try {
        localStorage.setItem(STORE_KEY, CHARACTERS[index].id);
      } catch {
        // Storage blocked: the choice just isn't remembered.
      }
      resolve(index);
    };
    panel.querySelector('.btn-start')!.addEventListener('click', go);
    (window as unknown as { __select?: (i: number) => void }).__select = (i: number) => {
      select(i);
      go();
    };
    (window as unknown as { __preview?: (i: number) => void }).__preview = select;
  });
}

async function startWalking(cast: Character[], index: number): Promise<void> {
  const me = cast[index];
  const lineup = me.root.parent!;
  scene.add(me.root);
  const spare = cast.filter((_, i) => i !== index);
  for (const c of spare) c.root.removeFromParent();
  lineup.removeFromParent();
  scene.add(playerShadow);

  rig.obstructed = (x, z) => world.colliders.blocked(x, z, 0.35);
  player = new PlayerController(me, world.colliders);
  player.place(SPAWN.x, SPAWN.z, SPAWN.yaw);
  rig.yaw = 0;
  rig.follow();

  zones = new ZoneManager({
    scene, camera, rig, canvas: app.canvas, input, player, setNight, seed,
    daily: seed === dateKey,
    preview: params.has('preview'),
  });
  zones.onEnter = () => {
    mode = 'zone';
    hud.hidden = true;
    help.hidden = true;
    mapEl.hidden = true;
    note.classList.remove('show');
  };
  zones.onExit = () => {
    mode = 'walk';
    hud.hidden = false;
  };
  mode = 'walk';
  input.enabled = true;
  hud.hidden = false;
  help.hidden = false;
  window.setTimeout(() => help.classList.add('fade'), 8000);
  hud.querySelector('[data-who]')!.addEventListener('click', () => location.reload());
  hud.querySelector('[data-map]')!.addEventListener('click', () => toggleMap());
  const soundBtn = hud.querySelector<HTMLButtonElement>('[data-sound]')!;
  const syncSound = () => {
    soundBtn.setAttribute('aria-pressed', String(!ambience.muted));
    soundBtn.innerHTML = icon(ambience.muted ? 'mute' : 'sound');
  };
  soundBtn.addEventListener('click', () => {
    ambience.setMuted(!ambience.muted);
    syncSound();
  });
  syncSound();
  document.title = `Kiwi Christmas · ${me.def.name}`;

  // The townsfolk, animals and things to find arrive just after you can walk.
  [life, collect] = await Promise.all([
    buildLife(scene, world, spare),
    buildCollect(scene, { toast: showNote, snapshot: () => app.snapshot(), onChange: refreshBadge }),
  ]);
  refreshBadge();

  (window as unknown as { __world?: unknown }).__world = {
    state: () => ({ mode, player: player.position.toArray().map((v) => +v.toFixed(2)), ground: +groundHeight(player.position.x, player.position.z).toFixed(2), anim: player.character.animation, fps: Math.round(app.fps), found: collect?.counts() }),
    zones: () => zones.list.map((z) => ({ id: z.def.id, playable: !!z.def.load, at: [+z.position.x.toFixed(1), +z.position.z.toFixed(1)] })),
    places: () => world.places,
    seats: () => world.seats,
    audit: () => world.audit(),
    teleport: (x: number, z: number, yaw?: number) => {
      player.place(x, z, yaw ?? player.yaw);
      rig.snap();
    },
    look: (yaw: number) => {
      rig.yaw = yaw;
      rig.snap();
    },
    enter: (id: string) => zones.enterById(id),
    leave: () => zones.leave(),
  };
}

function refreshBadge(): void {
  const c = collect?.counts();
  const badge = hud.querySelector<HTMLElement>('.badge')!;
  badge.hidden = !c || c.found === 0;
  if (c) badge.textContent = String(c.found);
}

// ---------------------------------------------------------------------------
// Map sheet: where to go, what you've found
// ---------------------------------------------------------------------------
function toggleMap(tab: 'map' | 'found' = 'map'): void {
  if (!mapEl.hidden && tab === 'map') {
    mapEl.hidden = true;
    return;
  }
  const p = player.position;
  const games = zones.list
    .map((z) => ({ ...z, d: Math.hypot(z.position.x - p.x, z.position.z - p.z) }))
    .sort((a, b) => Number(!!b.def.load) - Number(!!a.def.load) || a.d - b.d);
  const places = world.places.map((pl) => ({ ...pl, d: Math.hypot(pl.x - p.x, pl.z - p.z), seen: visited.has(pl.id) })).sort((a, b) => a.d - b.d);
  // A plan of the bay, north up.
  const sx = (x: number) => ((x + 210) / 420) * 100;
  const sz = (z: number) => ((z + 185) / 360) * 100;
  const c = collect?.counts();
  mapEl.innerHTML = `
    <div class="map-card" role="dialog" aria-label="Map and notebook">
      <div class="map-head">
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="map" aria-selected="${tab === 'map'}">Map</button>
          <button role="tab" data-tab="found" aria-selected="${tab === 'found'}">Notebook${c ? ` <span>${c.found}/${c.total}</span>` : ''}</button>
        </div>
        <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <div data-pane="map" ${tab === 'map' ? '' : 'hidden'}>
        <div class="map-plan" aria-hidden="true">
          <div class="plan-farm"></div><div class="plan-bush"></div><div class="plan-sand"></div><div class="plan-sea"></div><div class="plan-street"></div>
          ${places.map((pl) => `<span class="plan-name ${pl.seen ? '' : 'unseen'}" style="left:${sx(pl.x)}%;top:${sz(pl.z)}%">${pl.seen ? pl.name : '?'}</span>`).join('')}
          ${games.map((z) => `<i class="dot ${z.def.load ? 'on' : ''}" style="left:${sx(z.position.x)}%;top:${sz(z.position.z)}%"></i>`).join('')}
          <i class="dot me" style="left:${sx(p.x)}%;top:${sz(p.z)}%"></i>
        </div>
        <h3>Games</h3>
        <ul class="map-list">
          ${games.map((z, i) => `
            <li><button data-game="${i}" ${z.def.load ? '' : 'disabled'}>
              <span class="tag ${z.def.kind}">${z.def.kind === 'learn' ? 'Learn' : 'Fun'}</span>
              <b>${z.def.title}</b>
              <small>${z.def.load ? `${Math.round(z.d)} m` : 'Coming soon'}</small>
            </button></li>`).join('')}
        </ul>
        <h3>Places <span>${places.filter((pl) => pl.seen).length}/${places.length} found</span></h3>
        <ul class="map-list">
          ${places.map((pl, i) => `
            <li><button data-place="${i}" ${pl.seen ? '' : 'disabled'}>
              <span class="tag place">${pl.seen ? 'Go' : '?'}</span>
              <b>${pl.seen ? pl.name : 'Somewhere new'}</b>
              <small>${Math.round(pl.d)} m</small>
            </button></li>`).join('')}
        </ul>
      </div>
      <div data-pane="found" class="notebook" ${tab === 'found' ? '' : 'hidden'}>${collect?.html() ?? ''}</div>
    </div>`;
  mapEl.hidden = false;
  mapEl.querySelector('[data-close]')!.addEventListener('click', () => (mapEl.hidden = true));
  mapEl.onclick = (e) => {
    if (e.target === mapEl) mapEl.hidden = true;
  };
  mapEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => toggleMap(b.dataset.tab as 'map' | 'found')));
  mapEl.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) =>
    b.addEventListener('click', () => {
      // Turn to face the game so "forward" takes you there.
      const target = games[Number(b.dataset.game)].position;
      rig.yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
      mapEl.hidden = true;
    }),
  );
  mapEl.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) =>
    b.addEventListener('click', () => {
      // Fast travel to somewhere you've already walked to.
      const pl = places[Number(b.dataset.place)];
      const spot = arrivalSpot(pl);
      player.place(spot.x, spot.z, player.yaw);
      rig.snap();
      mapEl.hidden = true;
    }),
  );
}

/** A clear, walkable spot at a place (its centre may be a building or a tree). */
function arrivalSpot(pl: Place): { x: number; z: number } {
  const probe = new THREE.Vector3();
  for (let r = 0; r < 14; r += 2) {
    for (let a = 0; a < 6.28; a += 0.8) {
      probe.set(pl.x + Math.cos(a) * r, 0, pl.z + Math.sin(a) * r);
      const before = probe.clone();
      world.colliders.resolve(probe, 0.6);
      if (before.distanceTo(probe) < 0.01) return { x: probe.x, z: probe.z };
    }
  }
  return { x: pl.x, z: pl.z };
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
const tmp = new THREE.Vector3();
const focus = new THREE.Vector3();
let stride = 0;
let placeCheck = 0;
const texel = (SHADOW_HALF * 2) / SHADOW_MAP;

app.onUpdate((dt, elapsed) => {
  world?.update(dt, elapsed);

  gpu.time.value = elapsed;
  day.update(dt);

  if (mode === 'select') {
    rig.update(dt, SELECT_AT);
    focus.copy(SELECT_AT);
  } else if (player) {
    input.update();
    if (mode === 'walk') {
      rig.yaw += input.consumeTurn();
      if (input.consumeInteract()) zones.interact();
      player.update(dt, input, rig.yaw);
      // Footsteps by surface.
      stride += player.speed * dt;
      if (stride > 1.15) {
        stride = 0;
        const { x, z } = player.position;
        const onDeck = groundHeight(x, z) > 0.1 && Math.abs(z - STREET_Z) < 4.2;
        ambience.step(onDeck || x < -40 && x > -50 && z > 100 ? 'hard' : biomeAt(x, z) === 'beach' ? 'sand' : 'grass');
      }
    }
    player.character.update(dt);
    zones.update(dt, elapsed);
    life?.update(dt, elapsed, player.position);
    if (mode === 'walk') collect?.update(dt, elapsed, player.position);
    rig.update(dt, player.position);
    playerShadow.position.set(player.position.x, groundHeight(player.position.x, player.position.z) + 0.03, player.position.z);
    playerShadow.visible = mode === 'walk';
    focus.copy(mode === 'zone' ? camera.position.clone().add(camera.getWorldDirection(tmp).multiplyScalar(12)).setY(player.position.y) : player.position);
    ambience.update(biomeAt(player.position.x, player.position.z), waterline(player.position.x) - player.position.z, gpu.night.value as number);

    placeCheck -= dt;
    if (placeCheck <= 0 && mode === 'walk') {
      placeCheck = 0.5;
      let here: Place | null = null;
      for (const pl of world.places) {
        const d = Math.hypot(pl.x - player.position.x, pl.z - player.position.z);
        if (d < pl.radius && (!here || pl.radius < here.radius)) here = pl;
      }
      placeLabel.textContent = here?.name ?? 'Pōhutukawa Bay';
      if (here && !visited.has(here.id)) {
        visited.add(here.id);
        try {
          localStorage.setItem(VISITED_KEY, JSON.stringify([...visited]));
        } catch {
          // Not remembered.
        }
        if (visited.size > 1) showNote('New place', here.name);
      }
    }
  }
  // Shadows follow the action, snapped to whole texels so their edges don't swim.
  focus.x = Math.round(focus.x / texel) * texel;
  focus.z = Math.round(focus.z / texel) * texel;
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(day.sunOffset);
  (gpu.focal.value as THREE.Vector3).copy(focus);
  sky.position.copy(camera.position);
});

boot().catch((err) => {
  console.error(err);
  loading.querySelector('p')!.textContent = 'Something went wrong loading the world. Try refreshing.';
});
