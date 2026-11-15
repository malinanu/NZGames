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
import { CHARACTERS, createCharacter, type AnimName, type Character, type CharacterDef } from '../character/character';
import { PlayerController } from '../character/controller';
import { brand } from '../shared/brand';
import { nzDateKey } from '../shared/rng';
import { buildWorld } from './map';
import { ZoneManager } from './zoneManager';
import { SPAWN } from './zones';
import { icon } from './icons';

const STORE_KEY = 'kiwi-christmas:character';
const params = new URLSearchParams(location.search);
const dateKey = nzDateKey();
const seed = params.get('seed') ?? dateKey;

const app = new App(document.getElementById('game') as HTMLCanvasElement);
const { scene, camera } = app;
const rig = new CameraRig(camera);
const input = new Input(app.canvas);

// ---------------------------------------------------------------------------
// Sky and light. The sun sits to the north (-Z), as it does at midday in Aotearoa.
// ---------------------------------------------------------------------------
const DAY = { top: new THREE.Color('#5fb8ff'), horizon: new THREE.Color('#d6f1ff'), fog: new THREE.Color('#cdeeff') };
const NIGHT = { top: new THREE.Color('#050b26'), horizon: new THREE.Color('#1d2b5c'), fog: new THREE.Color('#14204a') };
const skyUniforms = { uTop: { value: DAY.top.clone() }, uHorizon: { value: DAY.horizon.clone() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(320, 24, 12),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir; void main(){ float t = smoothstep(-0.05, 0.55, vDir.y); gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0); }',
  }),
);
sky.renderOrder = -1;
scene.add(sky);
scene.fog = new THREE.Fog(DAY.fog.clone(), 70, 190);

const hemi = new THREE.HemisphereLight('#eaf7ff', '#6e9a52', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-14, 34, -20);

let nightGoal = 0;
let night = 0;
function setNight(amount: number): void {
  nightGoal = amount;
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
  <button class="icon-btn" data-map aria-label="Map of the games">${icon('map')}</button>
  <div class="hud-title"><b>Kiwi Christmas</b><span>${brand.presenter} ${brand.campaign}</span></div>
  <button class="icon-btn" data-who aria-label="Change character">${icon('user')}</button>`;
document.body.appendChild(hud);
const help = document.createElement('div');
help.className = 'walk-help';
help.hidden = true;
help.innerHTML = `<span class="only-touch">Drag on the left to walk · drag on the right to look</span><span class="only-mouse">WASD to walk · Q/R to look · Space to jump · E to play</span>`;
document.body.appendChild(help);
const mapEl = document.createElement('div');
mapEl.className = 'map-sheet';
mapEl.hidden = true;
document.body.appendChild(mapEl);

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
const npcs: Character[] = [];
let worldUpdate: (dt: number, t: number) => void = () => {};
let mode: 'select' | 'walk' | 'zone' = 'select';

async function boot(): Promise<void> {
  app.start();
  setProgress(0.08);
  const worldPromise = buildWorld(scene).then((w) => {
    setProgress(0.6);
    return w;
  });
  const cast = await Promise.all(CHARACTERS.map((def) => createCharacter(def)));
  setProgress(0.75);
  const world = await worldPromise;
  worldUpdate = world.update;
  setProgress(1);

  // The player controller is created for the chosen character in pickCharacter().
  const lineup = new THREE.Group();
  cast.forEach((c, i) => {
    c.root.position.set((i - (cast.length - 1) / 2) * 1.35, 0, 3.5);
    c.root.rotation.y = 0;
    c.play(i % 2 ? 'Idle_B' : 'Idle_A');
    lineup.add(c.root);
  });
  scene.add(lineup);
  app.onUpdate((dt) => cast.forEach((c) => c.update(dt)));

  window.setTimeout(() => loading.classList.add('done'), 150);
  window.setTimeout(() => (loading.hidden = true), 700);

  const saved = (() => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  })();
  const chosen = await chooseCharacter(cast, saved, world.colliders);
  startWalking(cast, chosen, world.colliders);
}

// ---------------------------------------------------------------------------
// Character select: the six stand on the green, the camera faces them
// ---------------------------------------------------------------------------
function chooseCharacter(cast: Character[], saved: string | null, _c: unknown): Promise<number> {
  mode = 'select';
  input.enabled = false;
  let index = Math.max(0, CHARACTERS.findIndex((c) => c.id === saved));
  const head = document.createElement('div');
  head.className = 'select-head';
  head.innerHTML = `<h1>Kia ora! Who's coming to the bach?</h1><p>Pick a character, then walk to a game and step into its ring to play.</p>`;
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
      c.root.position.z = k === i ? 4.3 : 3.5;
      if (k === i) c.play('Waving', { then: () => c.play('Idle_A') });
      else if (c.animation === 'Waving') c.play('Idle_A');
    });
    cards[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // Frame the chosen one; on a wide screen the whole line-up fits anyway.
    const x = cast[i].root.position.x * (camera.aspect < 1 ? 1 : 0.25);
    rig.shot(new THREE.Vector3(x * 0.85, 2.0, 10.6), new THREE.Vector3(x, 1.15, 3.8), 3);
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
  });
}

/** Spots where the cast who aren't playing hang out. */
const HANGOUTS: { x: number; z: number; yaw: number; anim: AnimName }[] = [
  { x: -26, z: -14.6, yaw: Math.PI, anim: 'Sit_Chair_Idle' },
  { x: 9.2, z: 30.6, yaw: Math.PI, anim: 'Idle_B' },
  { x: -6.5, z: 41, yaw: 0.4, anim: 'Lie_Idle' },
  { x: -4.6, z: 0, yaw: Math.PI / 2, anim: 'Sit_Chair_Idle' },
  { x: 33, z: -26.5, yaw: Math.PI, anim: 'Digging' },
  { x: 26, z: 45.5, yaw: Math.PI, anim: 'Sit_Floor_Idle' },
];

function startWalking(cast: Character[], index: number, colliders: import('../engine/colliders').Colliders): void {
  const def: CharacterDef = CHARACTERS[index];
  const me = cast[index];
  const lineup = me.root.parent!;
  me.root.removeFromParent();
  scene.add(me.root);
  cast.forEach((c, i) => {
    if (i === index) return;
    c.root.removeFromParent();
    const spot = HANGOUTS[npcs.length % HANGOUTS.length];
    c.root.position.set(spot.x, 0, spot.z);
    c.root.rotation.y = spot.yaw;
    c.play(spot.anim);
    scene.add(c.root);
    npcs.push(c);
    colliders.circle(spot.x, spot.z, 0.45);
  });
  lineup.removeFromParent();
  player = new PlayerController(me, colliders);
  player.place(SPAWN.x, SPAWN.z + 3, SPAWN.yaw);
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
  };
  zones.onExit = () => {
    mode = 'walk';
    hud.hidden = false;
  };
  mode = 'walk';
  input.enabled = true;
  hud.hidden = false;
  help.hidden = false;
  window.setTimeout(() => help.classList.add('fade'), 7000);
  hud.querySelector('[data-who]')!.addEventListener('click', () => location.reload());
  hud.querySelector('[data-map]')!.addEventListener('click', () => toggleMap());
  document.title = `Kiwi Christmas · ${def.name}`;

  (window as unknown as { __world?: unknown }).__world = {
    state: () => ({ mode, player: player.position.toArray().map((v) => +v.toFixed(2)), anim: player.character.animation, fps: Math.round(app.fps) }),
    zones: () => zones.list.map((z) => ({ id: z.def.id, playable: !!z.def.load, at: [+z.position.x.toFixed(1), +z.position.z.toFixed(1)] })),
    teleport: (x: number, z: number) => player.place(x, z, player.yaw),
    enter: (id: string) => zones.enterById(id),
    leave: () => zones.leave(),
  };
}

// ---------------------------------------------------------------------------
// Map sheet: every game, how far away, and a "show me" that turns the camera to it
// ---------------------------------------------------------------------------
function toggleMap(): void {
  if (!mapEl.hidden) {
    mapEl.hidden = true;
    return;
  }
  const p = player.position;
  const items = zones.list
    .map((z) => ({ ...z, d: Math.hypot(z.position.x - p.x, z.position.z - p.z) }))
    .sort((a, b) => Number(!!b.def.load) - Number(!!a.def.load) || a.d - b.d);
  // Simple top-down plan of the town, north up.
  const sx = (x: number) => ((x + 64) / 128) * 100;
  const sz = (z: number) => ((z + 64) / 118) * 100;
  mapEl.innerHTML = `
    <div class="map-card" role="dialog" aria-label="Map of the games">
      <div class="map-head"><h2>Where to?</h2><button class="icon-btn" data-close aria-label="Close map">${icon('close')}</button></div>
      <div class="map-plan" aria-hidden="true">
        <div class="plan-sea"></div><div class="plan-sand"></div><div class="plan-street"></div><div class="plan-bush"></div>
        ${items.map((z) => `<i class="dot ${z.def.load ? 'on' : ''}" style="left:${sx(z.position.x)}%;top:${sz(z.position.z)}%"></i>`).join('')}
        <i class="dot me" style="left:${sx(p.x)}%;top:${sz(p.z)}%"></i>
      </div>
      <ul class="map-list">
        ${items.map((z, i) => `
          <li><button data-go="${i}" ${z.def.load ? '' : 'disabled'}>
            <span class="tag ${z.def.kind}">${z.def.kind === 'learn' ? 'Learn' : 'Fun'}</span>
            <b>${z.def.title}</b>
            <small>${z.def.load ? `${Math.round(z.d)} m away` : 'Coming soon'}</small>
          </button></li>`).join('')}
      </ul>
    </div>`;
  mapEl.hidden = false;
  mapEl.querySelector('[data-close]')!.addEventListener('click', () => (mapEl.hidden = true));
  mapEl.addEventListener('click', (e) => {
    if (e.target === mapEl) mapEl.hidden = true;
  });
  mapEl.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = items[Number(b.dataset.go)].position;
      // Point the camera (and so "forward") towards the game.
      rig.yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
      mapEl.hidden = true;
    }),
  );
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
const tmp = new THREE.Vector3();
app.onUpdate((dt, elapsed) => {
  worldUpdate(dt, elapsed);
  night += (nightGoal - night) * (1 - Math.exp(-dt * 3));
  skyUniforms.uTop.value.lerpColors(DAY.top, NIGHT.top, night);
  skyUniforms.uHorizon.value.lerpColors(DAY.horizon, NIGHT.horizon, night);
  (scene.fog as THREE.Fog).color.lerpColors(DAY.fog, NIGHT.fog, night);
  hemi.intensity = THREE.MathUtils.lerp(1.25, 0.45, night);
  sun.intensity = THREE.MathUtils.lerp(2.4, 0.18, night);

  for (const n of npcs) n.update(dt);
  if (mode === 'select') {
    rig.update(dt, tmp.set(0, 0, 3.5));
    sun.target.position.set(0, 0, 3);
  } else if (player) {
    input.update();
    if (mode === 'walk') {
      rig.yaw += input.consumeTurn();
      if (input.consumeInteract()) zones.interact();
      player.update(dt, input, rig.yaw);
    }
    player.character.update(dt);
    zones.update(dt, elapsed);
    rig.update(dt, player.position);
    // Shadows follow whatever the camera is looking at.
    sun.target.position.copy(mode === 'zone' ? camera.position.clone().add(camera.getWorldDirection(tmp).multiplyScalar(10)).setY(0) : player.position);
  }
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  sky.position.copy(camera.position);
});

boot().catch((err) => {
  console.error(err);
  loading.querySelector('p')!.textContent = 'Something went wrong loading the world. Try refreshing.';
});
