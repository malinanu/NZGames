import * as THREE from 'three';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import type { Character } from '../../character/character';
import { best, burst, Countdown, disposeTree, fitDistance, frame, helper, mesh, toScreen, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Snags & Pav: BBQ Rush on the bach deck. The whānau queue up with orders. Put food on the
 * grill, take it off when it's cooked (before it burns), and serve whoever ordered it. Pav is
 * cut fresh from the fridge. Everyone's patience runs down; keep the queue happy for 90 s.
 */
const TIME = 90;
const SLOTS = 4;
const COOK = 5;
const BURN = 10;
const PATIENCE = 26;

type Food = 'snag' | 'patty' | 'corn' | 'pav';
const FOOD: Record<Food, { name: string; raw: string; done: string; grill: boolean; value: number }> = {
  snag: { name: 'Snag', raw: '#d98b7a', done: '#8a3b2e', grill: true, value: 2 },
  patty: { name: 'Burger', raw: '#c4776a', done: '#5a3020', grill: true, value: 3 },
  corn: { name: 'Corn', raw: '#f2e08a', done: '#e0a93a', grill: true, value: 2 },
  pav: { name: 'Pav slice', raw: '#fbfbf6', done: '#fbfbf6', grill: false, value: 3 },
};

interface Slot { food: Food | null; t: number; mesh: THREE.Mesh }
interface Customer { who: Character; wants: Food; patience: number; spot: number; label: HTMLElement; leaving: number }

type Phase = 'idle' | 'play' | 'done';
const tmpColour = new THREE.Color();

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;

  // -- The BBQ, bench and fridge on the deck ---------------------------------------------
  const grill = new THREE.Group();
  grill.add(mesh(new THREE.BoxGeometry(1.4, 0.85, 0.7), '#2a2d33', 0, 0.425, 0));
  grill.add(mesh(new THREE.BoxGeometry(1.3, 0.04, 0.6), '#555b63', 0, 0.87, 0));
  for (let i = 0; i < 7; i++) grill.add(mesh(new THREE.BoxGeometry(1.25, 0.02, 0.02), '#9aa0a8', 0, 0.9, -0.27 + i * 0.09));
  const lid = mesh(new THREE.BoxGeometry(1.4, 0.5, 0.06), '#2a2d33', 0, 1.15, -0.36);
  grill.add(lid);
  grill.position.set(-1.6, 0.22, -0.6);
  root.add(grill);
  const slots: Slot[] = Array.from({ length: SLOTS }, (_, i) => {
    const m = mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8).rotateZ(Math.PI / 2), '#d98b7a', -0.45 + i * 0.3, 0.95, 0);
    m.material = new THREE.MeshLambertMaterial({ color: '#d98b7a' });
    m.visible = false;
    grill.add(m);
    return { food: null, t: 0, mesh: m };
  });
  const smoke = burst(30, ['#d9d9d9', '#bfbfbf', '#eeeeee'], 0.2);
  root.add(smoke.object);
  root.add(mesh(new THREE.BoxGeometry(0.8, 1.7, 0.7), '#f4f7fb', 1.9, 0.22 + 0.85, -0.7));
  root.add(mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), '#9aa0a8', 1.55, 1.4, -0.33));

  const queueSpots = [v3(-1.2, 0.22, 1.4), v3(0, 0.22, 1.6), v3(1.2, 0.22, 1.4), v3(2.3, 0.22, 2.3)];
  const pool = await Promise.all([0, 1, 2, 3].map((i) => helper(ctx, i)));
  pool.forEach((c) => (c.root.visible = false));
  const labelLayer = document.createElement('div');
  labelLayer.className = 'float-labels';

  // -- State ---------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let clock = new Countdown(TIME);
  let score = 0;
  let served = 0;
  let lost = 0;
  let burnt = 0;
  let customers: Customer[] = [];
  let spawnIn = 0;
  let auto = false;
  let rng = mulberry32(hashString(`bbq:${ctx.seed}`));

  const sheetEl = document.createElement('div');
  const hud = () => ui.stats([{ label: 'Time', value: clock.label }, { label: 'Served', value: String(served) }, { label: 'Points', value: String(score) }]);
  const renderSheet = () => {
    sheetEl.innerHTML = `
      <div class="tool-row grill">${slots
        .map((s, i) => {
          const state = !s.food ? 'Empty' : s.t >= BURN ? 'Burnt!' : s.t >= COOK ? 'Ready' : 'Cooking';
          const pct = s.food ? Math.min(100, (s.t / COOK) * 100) : 0;
          return `<button class="pick slot ${state === 'Ready' ? 'on' : ''} ${state === 'Burnt!' ? 'burnt' : ''}" data-slot="${i}" ${s.food ? '' : 'disabled'}><b>${s.food ? FOOD[s.food].name : 'Grill'}</b><small>${state}</small><i style="--p:${pct}%"></i></button>`;
        })
        .join('')}</div>
      <div class="tool-row four">${(['snag', 'patty', 'corn', 'pav'] as Food[]).map((f) => `<button class="btn" data-food="${f}">${f === 'pav' ? 'Cut pav' : `+ ${FOOD[f].name}`}</button>`).join('')}</div>`;
    sheetEl.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => takeOff(Number(b.dataset.slot))));
    sheetEl.querySelectorAll<HTMLButtonElement>('[data-food]').forEach((b) => b.addEventListener('click', () => add(b.dataset.food as Food)));
  };

  const add = (f: Food) => {
    if (phase !== 'play') return;
    if (f === 'pav') return serve('pav');
    const s = slots.find((x) => !x.food);
    if (!s) return ui.toast('Grill’s full', 'info');
    s.food = f;
    s.t = 0;
    s.mesh.visible = true;
    s.mesh.scale.set(f === 'patty' ? 0.7 : 1, f === 'patty' ? 2.2 : 1, f === 'patty' ? 2.2 : 1);
    renderSheet();
  };
  const takeOff = (i: number) => {
    const s = slots[i];
    if (!s.food || phase !== 'play') return;
    if (s.t < COOK) return ui.toast('Still raw in the middle!', 'bad');
    const f = s.food;
    s.food = null;
    s.mesh.visible = false;
    if (s.t >= BURN) {
      burnt++;
      ui.toast('Burnt to a crisp. Into the bin.', 'bad');
    } else serve(f);
    renderSheet();
  };
  const serve = (f: Food) => {
    const c = customers.filter((x) => x.leaving === 0 && x.wants === f).sort((a, b) => a.patience - b.patience)[0];
    if (!c) return ui.toast(`Nobody's after a ${FOOD[f].name.toLowerCase()} right now`, 'info');
    const tip = c.patience > PATIENCE * 0.5 ? 1 : 0;
    score += FOOD[f].value + tip;
    served++;
    c.leaving = 1;
    c.who.play('Cheering');
    c.label.textContent = tip ? 'Choice, thanks!' : 'Ta';
    c.label.className = 'float-label';
    ctx.player.character.play('Use_Item');
    hud();
  };

  const spawn = () => {
    const free = queueSpots.map((_, i) => i).filter((i) => !customers.some((c) => c.spot === i));
    const who = pool.find((p) => !customers.some((c) => c.who === p));
    if (!free.length || !who) return;
    const spot = free[Math.floor(rng() * free.length)];
    const options: Food[] = ['snag', 'snag', 'patty', 'corn', 'pav'];
    const wants = options[Math.floor(rng() * options.length)];
    who.root.visible = true;
    who.root.position.copy(queueSpots[spot]);
    who.root.rotation.y = Math.atan2(-1.6 - queueSpots[spot].x, -0.6 - queueSpots[spot].z);
    who.play('Idle_B');
    const label = document.createElement('div');
    label.className = 'float-label order';
    label.textContent = FOOD[wants].name;
    labelLayer.appendChild(label);
    customers.push({ who, wants, patience: PATIENCE, spot, label, leaving: 0 });
  };

  const finish = () => {
    phase = 'done';
    ui.sheet(null);
    labelLayer.remove();
    const b = best('bbq', ctx.seed, score);
    ui.end(
      {
        title: score >= 40 ? 'Grill master' : score >= 20 ? 'Fed the whānau' : 'Hungry queue',
        score: `${score} pts`,
        grid: [{ label: `${served} served`, tone: 'good' }, { label: `${lost} walked off`, tone: lost ? 'bad' : 'neutral' }, { label: `${burnt} burnt`, tone: burnt ? 'bad' : 'neutral' }],
        shareGrid: '🌭'.repeat(Math.min(served, 12)),
        note: b > score ? `Best today: ${b}` : 'Same queue for everyone today.',
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  const reset = () => {
    for (const c of customers) {
      c.label.remove();
      c.who.root.visible = false;
    }
    customers = [];
    for (const s of slots) {
      s.food = null;
      s.mesh.visible = false;
    }
    score = 0;
    served = 0;
    lost = 0;
    burnt = 0;
    spawnIn = 0.5;
    rng = mulberry32(hashString(`bbq:${ctx.seed}`));
  };

  const zone: GameZone = {
    start() {
      reset();
      clock = new Countdown(TIME);
      phase = 'play';
      document.body.appendChild(labelLayer);
      ctx.player.place(v3(-1.6, 0, 0.2), Math.PI);
      const d = fitDistance(ctx, 6, 4.8);
      frame(ctx, v3(0.2, 1 + d * 0.6, 0.6 + d * 0.8), v3(0.2, 0.9, 0.3));
      ui.hint('Add food to the grill, tap it when it says Ready, and it goes to whoever ordered it. Don’t let it burn!');
      renderSheet();
      ui.sheet(sheetEl);
      hud();
    },
    stop() {
      auto = false;
      phase = 'idle';
      ui.sheet(null);
      labelLayer.remove();
      reset();
    },
    update(dt, elapsed) {
      smoke.update(dt);
      if (phase !== 'play') return;
      if (clock.tick(dt)) return finish();
      let changed = false;
      for (const s of slots) {
        if (!s.food) continue;
        const before = s.t >= COOK ? (s.t >= BURN ? 2 : 1) : 0;
        s.t += dt;
        const after = s.t >= COOK ? (s.t >= BURN ? 2 : 1) : 0;
        if (before !== after) changed = true;
        const f = FOOD[s.food];
        (s.mesh.material as THREE.MeshLambertMaterial).color.set(f.raw).lerp(tmpColour.set(s.t >= BURN ? '#1b1b1f' : f.done), Math.min(1, s.t / (s.t >= BURN ? BURN : COOK)));
        if (Math.random() < dt * 2) smoke.fire(root.worldToLocal(s.mesh.getWorldPosition(v3())), 0.15);
      }
      spawnIn -= dt;
      if (spawnIn <= 0) {
        spawn();
        spawnIn = 3.5 + rng() * 3 - Math.min(2, (TIME - clock.left) / 40);
      }
      for (const c of customers) {
        const at = c.who.root.position.clone().add(v3(0, 2.1, 0));
        const s = toScreen(ctx, at);
        c.label.style.transform = `translate(-50%, -100%) translate(${s.x}px, ${s.y}px)`;
        if (c.leaving) {
          c.leaving += dt;
          continue;
        }
        c.patience -= dt;
        c.label.style.setProperty('--p', `${(c.patience / PATIENCE) * 100}%`);
        c.label.classList.toggle('bad', c.patience < PATIENCE * 0.3);
        if (c.patience <= 0) {
          lost++;
          c.leaving = 1;
          c.who.play('Hit_A');
          c.label.textContent = 'Starving!';
          hud();
        }
      }
      for (const c of customers.filter((x) => x.leaving > 1.4)) {
        c.label.remove();
        c.who.root.visible = false;
      }
      customers = customers.filter((x) => x.leaving <= 1.4);
      if (auto) {
        // Keep one of each order on the grill, take things off when ready, cut pav when asked.
        for (const [i, s] of slots.entries()) if (s.food && s.t >= COOK && s.t < BURN) takeOff(i);
        for (const c of customers) {
          if (c.leaving) continue;
          if (c.wants === 'pav') serve('pav');
          else if (!slots.some((s) => s.food === c.wants)) add(c.wants);
        }
      }
      if (changed || Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) renderSheet();
      hud();
      lid.rotation.x = -0.9;
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, score, served, lost, burnt, time: Math.round(clock.left) }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  return zone;
}
