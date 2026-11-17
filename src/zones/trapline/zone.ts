import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import { icon } from '../../world/icons';
import { controls, cursorRing, step, usingButtons } from '../kit';
import type { GameZone, ZoneContext } from '../types';
import { buildBird, buildBlossom, buildHex, buildNest, buildPredator, buildTrap, buildTunnel, SPECIES_COLOUR, SPECIES_NAME } from './models';
import { key, NIGHTS, Sim, SPECIES, type NightReport, type Species, type Tile, type Tool } from './sim';

/**
 * Trap Line, played on a raised hex board in the bush clearing. Board coordinates are the
 * zone's local space; the board itself sits a little above the ground like a diorama.
 *
 * NOTE: predator behaviour is a simplified model and must be checked by DOC or a community
 * trapping group before launch (see sim.ts).
 */
const HEX_SIZE = 2 / Math.sqrt(3);
const BOARD_Y = 0.35;
const STEP_SECONDS = 0.6;
const BIRD_COLOURS = ['#2f6f73', '#8aa23b', '#b9895a', '#6a8f9c', '#7a5a3a'];

const tilePos = (t: { q: number; r: number }) => new THREE.Vector3(2 * (t.q + t.r / 2), 0, 1.5 * HEX_SIZE * t.r);
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

const chip = (species: Species, count?: number) =>
  `<span class="chip"><i style="background:${SPECIES_COLOUR[species]}"></i>${SPECIES_NAME[species]}${count === undefined ? '' : ` ×${count}`}</span>`;

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const board = new THREE.Group();
  board.position.y = BOARD_Y;
  root.add(board);
  const revealAll = new URLSearchParams(location.search).has('reveal');
  const label = ctx.daily ? nzDateLabel() : `#${ctx.seed}`;
  let sim = new Sim(ctx.seed);
  const decoRng = mulberry32(hashString(`trap-line-deco:${ctx.seed}`));

  // -- Board (built once: the map only depends on the seed) ---------------------
  const jobs: Promise<void>[] = [];
  const add = (model: string, at: THREE.Vector3, opts: { width?: number; height?: number; rot?: number }) =>
    jobs.push(spawnProp(model, opts).then((p) => {
      p.object.position.copy(at);
      p.object.rotation.y = opts.rot ?? 0;
      board.add(p.object);
    }));
  const trees = ['forest/Tree_1_A_Color1', 'forest/Tree_1_B_Color1', 'forest/Tree_4_A_Color1', 'forest/Tree_2_A_Color1'];
  const nests = new Map<string, THREE.Group>();
  for (const t of sim.tiles.values()) {
    const at = tilePos(t);
    // A plinth under every tile so the board reads as a raised diorama.
    const plinth = buildHex(HEX_SIZE * 1.002, '#6b5038', BOARD_Y + 0.02);
    plinth.position.x = at.x;
    plinth.position.z = at.z;
    board.add(plinth);
    if (t.terrain === 'farm') {
      const hex = buildHex(HEX_SIZE, '#d8cf7a', 0.06);
      hex.position.set(at.x, 0.03, at.z);
      board.add(hex);
      add('hexagon/fence_wood_straight', at.clone().add(new THREE.Vector3(-0.55, 0, 0)), { width: 1.7 });
      continue;
    }
    jobs.push(spawnProp(t.terrain === 'water' ? 'hexagon/hex_water' : 'hexagon/hex_grass').then((p) => {
      p.object.position.set(at.x, -p.size.y + 0.04, at.z);
      board.add(p.object);
    }));
    if (t.terrain === 'bush') {
      const count = 2 + Math.floor(decoRng() * 2);
      for (let i = 0; i < count; i++) {
        const offset = new THREE.Vector3((i - (count - 1) / 2) * 0.62 + (decoRng() - 0.5) * 0.2, 0, -0.5 + decoRng() * 0.25);
        add(trees[Math.floor(decoRng() * trees.length)], at.clone().add(offset), { height: 1.15 + decoRng() * 0.6, rot: decoRng() * 6.28 });
      }
    } else if (t.terrain === 'pohutukawa') {
      const treeAt = at.clone().add(new THREE.Vector3(0, 0, -0.35));
      add('forest/Tree_2_A_Color1', treeAt, { height: 2.1, rot: decoRng() * 6.28 });
      const blossom = buildBlossom(1.7, 2.1, decoRng);
      blossom.position.copy(treeAt);
      board.add(blossom);
    } else if (t.terrain === 'bach') {
      add('hexagon/building_home_A_blue', at, { height: 1.9, rot: -0.6 });
    }
    if (t.nest) {
      const nest = buildNest();
      nest.position.copy(at).add(new THREE.Vector3(0.25, 0, 0.5));
      board.add(nest);
      nests.set(key(t.q, t.r), nest);
    }
  }
  await Promise.all(jobs);

  // -- Per-game state ------------------------------------------------------------
  type Phase = 'idle' | 'evening' | 'night' | 'morning' | 'end';
  let phase: Phase = 'idle';
  let tool: Tool = 'trap';
  let report: NightReport | null = null;
  let nightClock = 0;
  let nightSteps = 0;
  const gear = new Map<string, THREE.Group>();
  const birds: THREE.Group[] = [];
  const critters = new Map<number, THREE.Group>();
  const trails = new THREE.Group();
  board.add(trails);
  const labelLayer = document.createElement('div');
  labelLayer.className = 'float-labels';
  const liveLabels: { node: HTMLElement; at: THREE.Vector3 }[] = [];

  const toWorld = (v: THREE.Vector3) => board.localToWorld(v.clone());
  const gearSpot = (t: { q: number; r: number }) => tilePos(t).add(new THREE.Vector3(-0.2, 0, 0.42));
  const addLabel = (html: string, at: THREE.Vector3, tone: string) => {
    const node = document.createElement('div');
    node.className = `float-label ${tone}`;
    node.innerHTML = html;
    labelLayer.appendChild(node);
    liveLabels.push({ node, at: toWorld(at) });
  };
  const clearLabels = () => {
    labelLayer.replaceChildren();
    liveLabels.length = 0;
  };
  const syncGear = () => {
    for (const [k, mesh] of gear) {
      if (sim.toolAt(k)) continue;
      board.remove(mesh);
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
        board.add(mesh);
        gear.set(k, mesh);
      }
    }
  };

  // -- Camera: frame the whole board whichever way the phone is held ---------------
  const frameBoard = () => {
    const vHalf = THREE.MathUtils.degToRad(ctx.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * ctx.camera.aspect);
    const distance = Math.max(7.8 / Math.tan(hHalf), 9.2 / Math.tan(vHalf));
    const tilt = THREE.MathUtils.degToRad(57);
    const centre = new THREE.Vector3(0, 0, 0.6);
    ctx.rig.shot(toWorld(new THREE.Vector3(0, Math.sin(tilt) * distance, Math.cos(tilt) * distance + centre.z)), toWorld(centre), 2.6);
  };

  // -- Sheets ----------------------------------------------------------------------
  const eveningSheet = document.createElement('div');
  eveningSheet.className = 'tool-row';
  eveningSheet.innerHTML = `
    <button class="tool" data-tool="trap" aria-pressed="true">${icon('trap', 24)}<span>Trap</span><small><b>0</b> left</small></button>
    <button class="tool" data-tool="tunnel" aria-pressed="false">${icon('tunnel', 24)}<span>Tunnel</span><small><b>0</b> left</small></button>
    <button class="btn btn-primary" data-go>${icon('moon')}<span>Night</span></button>`;
  eveningSheet.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as Tool;
      refreshHud();
    }),
  );
  eveningSheet.querySelector('[data-go]')!.addEventListener('click', () => startNight());
  const morningSheet = document.createElement('div');
  morningSheet.innerHTML = `<div class="sheet-title"></div><div class="sheet-body"></div><button class="btn btn-primary btn-wide" data-next></button>`;
  morningSheet.querySelector('[data-next]')!.addEventListener('click', () => (sim.finished ? showEnd() : startEvening()));

  const refreshHud = () => {
    const sleeps = NIGHTS - sim.night;
    const sleepText = sleeps === 0 ? 'Christmas morning!' : `${sleeps} ${sleeps === 1 ? 'sleep' : 'sleeps'} to Christmas`;
    ui.subtitle(phase === 'night' ? `Night ${sim.night} of ${NIGHTS}…` : phase === 'morning' ? `Morning ${sim.night} · ${sleepText}` : `Evening ${sim.night + 1} of ${NIGHTS} · ${sleepText}`);
    ui.stats([{ label: 'Birds', value: String(sim.birds) }]);
    for (const t of ['trap', 'tunnel'] as const) {
      const b = eveningSheet.querySelector<HTMLButtonElement>(`[data-tool="${t}"]`)!;
      b.querySelector('b')!.textContent = String(sim.remaining(t));
      b.setAttribute('aria-pressed', String(tool === t));
    }
  };

  // -- Phases ------------------------------------------------------------------------
  const startEvening = () => {
    phase = 'evening';
    report = null;
    clearLabels();
    trails.clear();
    for (const b of birds) board.remove(b);
    birds.length = 0;
    for (const nest of nests.values()) nest.getObjectByName('eggs')!.visible = true;
    for (const mesh of gear.values()) {
      const flag = mesh.getObjectByName('flag');
      if (flag) flag.visible = false;
    }
    ctx.setNight(0);
    ui.sheet(eveningSheet);
    refreshHud();
  };
  const startNight = () => {
    if (phase !== 'evening') return;
    report = sim.runNight();
    phase = 'night';
    nightClock = 0;
    nightSteps = Math.max(...report.predators.map((p) => p.steps.length - 1), 1);
    for (const p of report.predators) {
      if (critters.has(p.id)) continue;
      const mesh = buildPredator(p.species);
      mesh.visible = false;
      board.add(mesh);
      critters.set(p.id, mesh);
    }
    ui.hint(null);
    ui.sheet(null);
    ctx.setNight(1);
    ctx.player.character.play('Sit_Floor_Idle');
    refreshHud();
  };
  const nearTunnel = (q: number, r: number) =>
    revealAll || sim.tunnels.has(key(q, r)) || sim.neighbours({ q, r }).some((n) => sim.tunnels.has(key(n.q, n.r)));
  const updateNight = (dt: number) => {
    if (!report) return;
    nightClock += dt;
    const t = Math.max(0, nightClock - 0.9) / STEP_SECONDS;
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
  };
  const startMorning = () => {
    if (!report) return;
    phase = 'morning';
    ctx.setNight(0);
    const r = report;
    for (const [id, mesh] of critters) {
      mesh.visible = false;
      if (!sim.predators.some((p) => p.id === id)) {
        board.remove(mesh);
        critters.delete(id);
      }
    }
    // Failure should teach: who raided which nest, and the route of anything trapped.
    for (const [k, species] of r.raided) {
      const [q, rr] = k.split(',').map(Number);
      nests.get(k)!.getObjectByName('eggs')!.visible = false;
      addLabel(`✕ ${chip(species)}`, tilePos({ q, r: rr }).add(new THREE.Vector3(0.25, 0.55, 0.5)), 'bad');
    }
    let birdIndex = 0;
    for (const [k, nest] of nests) {
      if (r.raided.has(k)) continue;
      const bird = buildBird(BIRD_COLOURS[birdIndex++ % BIRD_COLOURS.length]);
      bird.position.copy(nest.position).add(new THREE.Vector3(0, 0.12, 0));
      bird.rotation.y = birdIndex * 1.3;
      bird.userData.phase = birdIndex;
      board.add(bird);
      birds.push(bird);
    }
    for (const k of sim.tunnels) {
      const [q, rr] = k.split(',').map(Number);
      const seen = r.prints.get(k) ?? [];
      addLabel(seen.length ? `Prints: ${seen.map((s) => chip(s)).join('')}` : 'Prints: none', gearSpot({ q, r: rr }).add(new THREE.Vector3(0, 0.55, 0)), 'info');
    }
    for (const p of r.predators) {
      if (p.caughtAt === null || p.caughtAt < 1) continue;
      const points = p.steps.slice(0, p.caughtAt + 1).map((s) => tilePos(s).setY(0.12));
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
      trails.add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 8, 0.05, 5), new THREE.MeshBasicMaterial({ color: SPECIES_COLOUR[p.species], transparent: true, opacity: 0.85 })));
    }
    const caught = SPECIES.filter((s) => r.caught[s] > 0).map((s) => chip(s, r.caught[s])).join('') || 'nothing';
    morningSheet.querySelector('.sheet-title')!.textContent = `Morning ${r.night}: ${r.nestsSafe} of ${r.nestsTotal} nests safe`;
    morningSheet.querySelector('.sheet-body')!.innerHTML = `Trapped: ${caught}<br>+${r.birdsGained} birds fledged`;
    morningSheet.querySelector('[data-next]')!.textContent = sim.finished ? 'Christmas morning' : `Set up night ${r.night + 1}`;
    ui.sheet(morningSheet);
    ctx.player.character.play(r.nestsSafe >= r.nestsTotal - 1 ? 'Cheering' : 'Idle_A');
    refreshHud();
  };
  const showEnd = () => {
    phase = 'end';
    clearLabels();
    const chorus = sim.chorus();
    const heard = chorus.filter((c) => c.here).length;
    ctx.player.character.play(heard >= 3 ? 'Cheering' : 'Idle_A');
    ui.end(
      {
        title: heard === chorus.length ? 'A full dawn chorus!' : heard ? 'The birds are coming back' : 'A quiet Christmas morning',
        score: `${sim.birds} birds`,
        shareGrid: chorus.map((c) => (c.here ? '🐦' : '▫️')).join(''),
        extra: `<ul class="chorus">${chorus.map((c) => `<li class="${c.here ? 'here' : ''}">${icon('bird', 18)} ${c.name}<small>${c.at} birds</small></li>`).join('')}</ul>`,
        note: 'Each bird joins the chorus once enough nests fledge.',
      },
      label,
    );
  };

  // -- Input -------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const tap = (clientX: number, clientY: number) => {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, ctx.camera);
    const planeY = toWorld(new THREE.Vector3()).y;
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), new THREE.Vector3());
    if (!hit) return;
    const local = board.worldToLocal(hit);
    const { q, r } = tileAt(local.x, local.z);
    const tile: Tile | undefined = sim.tiles.get(key(q, r));
    if (tile) place(tile);
  };
  const place = (tile: Tile) => {
    if (phase !== 'evening') return;
    const outcome = sim.toggle(tile, tool);
    if (outcome === 'none') {
      if (tile.nest) ui.toast('Not on the nest: set it nearby', 'info');
      else if (!sim.canPlace(tile)) ui.toast("Can't put gear there", 'info');
      else ui.toast(`No ${tool === 'trap' ? 'traps' : 'tunnels'} left. Tap one to move it`, 'info');
      return;
    }
    ui.hint(null);
    syncGear();
    refreshHud();
  };
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tap(e.clientX, e.clientY);
    down = null;
  };
  const onResize = () => phase !== 'idle' && frameBoard();

  // Keyboard/gamepad: a cursor ring moves between tiles.
  const ring = cursorRing(0.78);
  board.add(ring.object);
  let cursor = '';
  const tileList = () => [...sim.tiles.values()];
  const startCursor = () => {
    const list = tileList().filter((t) => sim.canPlace(t));
    list.sort((a, b) => tilePos(a).length() - tilePos(b).length());
    cursor = list[0] ? key(list[0].q, list[0].r) : '';
  };
  const padInput = () => {
    const input = ctx.input;
    if (phase === 'evening') {
      const nav = input.nav();
      if (nav.x || nav.y) {
        const list = tileList();
        const i = list.findIndex((t) => key(t.q, t.r) === cursor);
        const j = step(ctx, list.map((t) => tilePos(t).setY(BOARD_Y)), i, nav);
        cursor = key(list[j].q, list[j].r);
      }
      if (input.confirm()) {
        const tile = sim.tiles.get(cursor);
        if (tile) place(tile);
      }
      if (input.pressed('west') || input.pressed('lb') || input.pressed('rb') || input.keyPressed('KeyT', 'KeyQ', 'KeyE')) {
        tool = tool === 'trap' ? 'tunnel' : 'trap';
        refreshHud();
      }
      if (input.pressed('north') || input.pressed('start') || input.keyPressed('Enter', 'KeyN')) startNight();
    } else if (phase === 'morning') {
      if (input.confirm() || input.pressed('north') || input.keyPressed('Enter')) sim.finished ? showEnd() : startEvening();
    }
  };

  const projected = new THREE.Vector3();
  const reset = () => {
    for (const mesh of gear.values()) board.remove(mesh);
    gear.clear();
    for (const mesh of critters.values()) board.remove(mesh);
    critters.clear();
    for (const b of birds) board.remove(b);
    birds.length = 0;
    trails.clear();
    clearLabels();
    for (const nest of nests.values()) nest.getObjectByName('eggs')!.visible = true;
  };

  const zone: GameZone = {
    start() {
      reset();
      sim = new Sim(ctx.seed);
      tool = 'trap';
      document.body.appendChild(labelLayer);
      ctx.canvas.addEventListener('pointerdown', onDown);
      ctx.canvas.addEventListener('pointerup', onUp);
      window.addEventListener('resize', onResize);
      ctx.player.place(new THREE.Vector3(-3.5, 0, 7.6), Math.PI);
      frameBoard();
      startCursor();
      const lore = 'Predators come over the farm fence and up the stream. Tunnels show whose prints passed.';
      ui.hint(controls({
        touch: `Tap a tile to set a trap. ${lore}`,
        keyboard: `Arrows pick a tile, {Space} sets gear, {T} swaps trap and tunnel, {Enter} starts the night. ${lore}`,
        pad: `Left stick picks a tile, {A} sets gear, {X} swaps trap and tunnel, {Y} starts the night. ${lore}`,
      }));
      startEvening();
    },
    stop() {
      ctx.canvas.removeEventListener('pointerdown', onDown);
      ctx.canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', onResize);
      labelLayer.remove();
      ctx.setNight(0);
      phase = 'idle';
      reset();
    },
    update(dt, elapsed) {
      padInput();
      const at = sim.tiles.get(cursor);
      ring.update(phase === 'evening' && usingButtons(ctx), at ? tilePos(at).setY(0.12) : null, elapsed);
      if (phase === 'night') updateNight(dt);
      for (const mesh of gear.values()) {
        mesh.userData.pop = Math.min(1, (mesh.userData.pop as number) + dt * 6);
        const p = mesh.userData.pop as number;
        mesh.scale.setScalar(1.25 * (1 + Math.sin(p * Math.PI) * 0.25) * Math.min(1, p * 2));
      }
      for (const bird of birds) bird.position.y = 0.12 + Math.abs(Math.sin(elapsed * 5 + (bird.userData.phase as number))) * 0.12;
      for (const { node, at } of liveLabels) {
        projected.copy(at).project(ctx.camera);
        node.style.transform = `translate(-50%, -100%) translate(${((projected.x + 1) / 2) * window.innerWidth}px, ${((1 - projected.y) / 2) * window.innerHeight}px)`;
      }
    },
    dispose() {
      zone.stop();
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
    debug: {
      state: () => ({ phase, cursor, tool, night: sim.night, birds: sim.birds, traps: [...sim.traps], tunnels: [...sim.tunnels], left: { trap: sim.remaining('trap'), tunnel: sim.remaining('tunnel') } }),
      tiles: () => [...sim.tiles.values()].map((t) => ({ ...t, canPlace: sim.canPlace(t), nearNest: sim.neighbours(t).some((n) => n.nest) })),
      screen: (q: number, r: number) => {
        const p = toWorld(tilePos({ q, r })).project(ctx.camera);
        return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
      },
      go: () => startNight(),
      next: () => (sim.finished ? showEnd() : startEvening()),
    },
  };
  return zone;
}
