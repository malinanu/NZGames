import * as THREE from 'three';
import { best, controls, cursorRing, disposeTree, fitDistance, frame, markCursor, mesh, pointer, step, toScreen, usingButtons, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Pōhutukawa Garden, a bare hillside clearing in the bush. Plant six natives so that something
 * is in flower in every month: tūī and other nectar-feeders only stay if there's food all year.
 * Then run the year and watch the birds come and go with the flowers.
 *
 * Flowering months are approximate (they shift with region and season) and should be checked
 * by DOC or a native plant nursery before launch.
 */
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BUDGET = 6;

interface Species {
  id: string;
  name: string;
  /** 0-based months in flower. */
  months: number[];
  flower: string;
  leaf: string;
  height: number;
}

const SPECIES: Species[] = [
  { id: 'pohutukawa', name: 'Pōhutukawa', months: [11, 0], flower: '#d7263d', leaf: '#3f6a34', height: 2.4 },
  { id: 'rata', name: 'Southern rātā', months: [0, 1, 2], flower: '#c41e3a', leaf: '#4a7a3a', height: 2.2 },
  { id: 'kohekohe', name: 'Kohekohe', months: [3, 4, 5, 6], flower: '#f4f0e6', leaf: '#2f6a3a', height: 2.2 },
  { id: 'puriri', name: 'Pūriri', months: [4, 5, 6, 7, 8], flower: '#c75b9b', leaf: '#3a7a40', height: 2.4 },
  { id: 'fivefinger', name: 'Whauwhaupaku', months: [5, 6, 7], flower: '#d8e3a0', leaf: '#4f8a3a', height: 1.8 },
  { id: 'kowhai', name: 'Kōwhai', months: [7, 8, 9], flower: '#ffd23f', leaf: '#7aa04a', height: 2.1 },
  { id: 'kotukutuku', name: 'Kōtukutuku', months: [8, 9, 10, 11], flower: '#6a2c70', leaf: '#5d8f45', height: 1.9 },
  { id: 'harakeke', name: 'Harakeke', months: [10, 11, 0], flower: '#8a2f22', leaf: '#3f6a34', height: 1.6 },
  { id: 'rewarewa', name: 'Rewarewa', months: [9, 10, 11], flower: '#9b2335', leaf: '#4a6a3a', height: 2.5 },
];

const PLOTS = Array.from({ length: 10 }, (_, i) => v3(((i % 5) - 2) * 2.4, 0, (Math.floor(i / 5) - 0.5) * 2.6 - 1));

type Phase = 'idle' | 'plant' | 'year' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  // Bare earth beds, each a planting spot.
  PLOTS.forEach((p) => {
    const bed = mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 16), '#7a5a3a', p.x, 0.06, p.z);
    root.add(bed);

  });
  const highlight = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 32), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.14;
  highlight.visible = false;
  root.add(highlight);
  const birds = Array.from({ length: 6 }, () => {
    const b = buildTui();
    b.visible = false;
    root.add(b);
    return b;
  });

  // -- State -------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let planted: (Species | null)[] = PLOTS.map(() => null);
  const plantMeshes: (THREE.Group | null)[] = PLOTS.map(() => null);
  let selectedPlot = -1;
  let month = 0;
  let monthT = 0;
  let auto = false;
  let bound: ReturnType<typeof pointer> | null = null;

  const covered = () => {
    const c = new Array(12).fill(false);
    for (const s of planted) if (s) for (const m of s.months) c[m] = true;
    return c;
  };
  const count = () => planted.filter(Boolean).length;
  const hud = () => {
    ui.subtitle(phase === 'year' ? MONTH_NAMES[month] : `${count()} of ${BUDGET} plants`);
    ui.stats([{ label: 'Months fed', value: `${covered().filter(Boolean).length}/12` }]);
  };

  const sheetEl = document.createElement('div');
  const render = () => {
    const c = covered();
    sheetEl.innerHTML = `
      <div class="calendar" aria-label="Nectar calendar">${MONTHS.map((m, i) => `<span class="${c[i] ? 'on' : ''}" title="${MONTH_NAMES[i]}">${m}</span>`).join('')}</div>
      <div class="puzzle">${selectedPlot < 0 ? 'Tap a bare bed on the hill, then choose what to plant. Fill every month of the calendar.' : `Plant in bed ${selectedPlot + 1}:`}</div>
      <div class="pick-row">${SPECIES.map((s) => `<button class="pick" data-s="${s.id}" ${selectedPlot < 0 ? 'disabled' : ''}><b>${s.name}</b><small>${s.months.map((m) => MONTHS[m]).join(' ')}</small></button>`).join('')}</div>
      <button class="btn btn-primary btn-wide" data-year ${count() ? '' : 'disabled'}>Run the year</button>`;
    sheetEl.querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => plant(selectedPlot, SPECIES.find((s) => s.id === b.dataset.s)!)));
    sheetEl.querySelector('[data-year]')!.addEventListener('click', () => runYear());
    ui.sheet(sheetEl);
    markCursor(sheetEl.querySelectorAll('[data-s]'), selectedPlot >= 0 ? speciesCursor : -1);
    hud();
  };

  const selectPlot = (i: number) => {
    if (phase !== 'plant') return;
    if (planted[i]) {
      // Tap a plant to pull it out again.
      root.remove(plantMeshes[i]!);
      plantMeshes[i] = null;
      planted[i] = null;
    } else if (count() >= BUDGET) {
      ui.toast(`Only ${BUDGET} plants this season. Tap one to swap it out`, 'info');
      return;
    }
    selectedPlot = planted[i] ? -1 : i;
    highlight.visible = selectedPlot >= 0;
    if (selectedPlot >= 0) highlight.position.set(PLOTS[i].x, 0.14, PLOTS[i].z);
    render();
  };

  const plant = (i: number, s: Species) => {
    if (i < 0 || planted[i] || phase !== 'plant') return;
    planted[i] = s;
    const g = buildPlant(s);
    g.position.copy(PLOTS[i]).setY(0.1);
    g.scale.setScalar(0.01);
    root.add(g);
    plantMeshes[i] = g;
    selectedPlot = -1;
    highlight.visible = false;
    render();
  };

  const runYear = () => {
    if (!count()) return;
    phase = 'year';
    month = 0;
    monthT = 0;
    ui.sheet(null);
    ui.hint(null);
    hud();
  };

  const showMonth = () => {
    // Flowers open and close, and birds turn up only where there's nectar.
    const feeding: number[] = [];
    planted.forEach((s, i) => {
      const open = !!s && s.months.includes(month);
      const flowers = plantMeshes[i]?.getObjectByName('flowers');
      if (flowers) flowers.visible = open;
      if (open) feeding.push(i);
    });
    birds.forEach((b, k) => {
      b.visible = feeding.length > 0 && k < Math.min(birds.length, feeding.length * 2);
      if (b.visible) {
        const p = PLOTS[feeding[k % feeding.length]];
        b.position.set(p.x + (k % 2 ? 0.5 : -0.5), 2.2 + (k % 3) * 0.2, p.z + 0.3);
      }
    });
    if (!feeding.length) ui.toast(`${MONTH_NAMES[month]}: nothing in flower. The birds leave.`, 'bad', 1100);
  };

  const finish = () => {
    phase = 'done';
    const c = covered();
    const fed = c.filter(Boolean).length;
    const b = best('garden', 'all', fed);
    if (fed === 12) ctx.player.character.play('Cheering');
    ui.end(
      {
        title: fed === 12 ? 'Nectar all year round!' : fed >= 9 ? 'Nearly there' : 'Hungry months',
        score: `${fed}/12 months`,
        grid: MONTH_NAMES.map((m, i) => ({ label: m.slice(0, 3), tone: c[i] ? 'good' : 'bad' })),
        shareGrid: c.map((x) => (x ? '🌺' : '🟫')).join(''),
        extra: '<div class="puzzle"><b>Why it matters:</b> tūī, korimako and kererū move around to follow food. A patch with something flowering or fruiting every month keeps them close all year.</div>',
        note: `Flowering months are approximate and vary around the country.${b > fed ? ` Your best: ${b}/12.` : ''}`,
      },
      'garden',
    );
  };

  // -- Keyboard/gamepad: the stick moves between beds, A picks the bed (A again plants),
  // LB/RB (Q/E) choose the plant, Y / Enter runs the year. ----------------------------------
  const ring = cursorRing(1.15);
  root.add(ring.object);
  let bedCursor = 2;
  let speciesCursor = 0;
  const padInput = () => {
    const input = ctx.input;
    const nav = input.nav();
    if (nav.x || nav.y) bedCursor = step(ctx, PLOTS, bedCursor, nav);
    const cycle = (input.pressed('rb') || input.keyPressed('KeyE') ? 1 : 0) - (input.pressed('lb') || input.keyPressed('KeyQ') ? 1 : 0);
    if (cycle) {
      speciesCursor = (speciesCursor + cycle + SPECIES.length) % SPECIES.length;
      markCursor(sheetEl.querySelectorAll('[data-s]'), selectedPlot >= 0 ? speciesCursor : -1);
    }
    if (input.confirm()) {
      if (selectedPlot === bedCursor) plant(selectedPlot, SPECIES[speciesCursor]);
      else selectPlot(bedCursor);
    }
    if (input.pressed('north') || input.pressed('start') || input.keyPressed('Enter')) runYear();
  };

  /** A planting that covers all twelve months within the budget (what the bot plants). */
  const SOLUTION = ['rata', 'kohekohe', 'fivefinger', 'kowhai', 'kotukutuku', 'pohutukawa'];

  const reset = () => {
    plantMeshes.forEach((m) => m && root.remove(m));
    planted = PLOTS.map(() => null);
    plantMeshes.fill(null);
    selectedPlot = -1;
    highlight.visible = false;
    birds.forEach((b) => (b.visible = false));
  };

  const zone: GameZone = {
    start() {
      reset();
      phase = 'plant';
      ctx.player.place(v3(-6.6, 0, 3.4), Math.PI * 0.8);
      const d = fitDistance(ctx, 13, 7.5);
      frame(ctx, v3(0, d * 0.75, d * 0.7), v3(0, 0, -1.2), 3.2, false);
      bound = pointer(ctx, {
        tap: (p) => {
          if (!p.ground) return;
          let bestI = -1;
          let bestD = 1.3;
          PLOTS.forEach((q, i) => {
            const dd = q.distanceTo(v3(p.ground!.x, 0, p.ground!.z));
            if (dd < bestD) {
              bestD = dd;
              bestI = i;
            }
          });
          if (bestI >= 0) selectPlot(bestI);
        },
      });
      bedCursor = 2;
      speciesCursor = 0;
      ui.hint(controls({
        touch: 'Each plant flowers in certain months. Pick six that cover the whole year.',
        keyboard: 'Arrows pick a bed, {Space} selects it, {Q} {E} choose a plant, {Space} plants it, {Enter} runs the year. Cover all twelve months.',
        pad: 'Left stick picks a bed, {A} selects it, {LB} {RB} choose a plant, {A} plants it, {Y} runs the year. Cover all twelve months.',
      }));
      render();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
    },
    update(dt, elapsed) {
      if (phase === 'plant' && !auto) padInput();
      ring.update(phase === 'plant' && usingButtons(ctx), PLOTS[bedCursor].clone().setY(0.16), elapsed);
      for (const m of plantMeshes) if (m && m.scale.x < 1) m.scale.setScalar(Math.min(1, m.scale.x + dt * 3));
      for (const [k, b] of birds.entries()) if (b.visible) b.position.y += Math.sin(elapsed * 8 + k) * 0.004;
      if (auto && phase === 'plant') {
        SOLUTION.forEach((id, i) => {
          if (!planted[i]) {
            selectedPlot = i;
            plant(i, SPECIES.find((s) => s.id === id)!);
          }
        });
        runYear();
      }
      if (phase !== 'year') return;
      monthT += dt;
      if (monthT === dt) showMonth();
      if (monthT > 0.9) {
        monthT = 0;
        month++;
        if (month >= 12) return finish();
        showMonth();
        hud();
      }
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, bedCursor, selectedPlot, speciesCursor, planted: planted.map((p) => p?.id ?? null), fed: covered().filter(Boolean).length, month }),
      bed: (i: number) => toScreen(ctx, PLOTS[i]),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  return zone;
}

function buildPlant(s: Species): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, s.height * 0.45, 6), '#6b4a2f', 0, s.height * 0.22, 0));
  const crown = mesh(new THREE.IcosahedronGeometry(s.height * 0.32, 1), s.leaf, 0, s.height * 0.62, 0);
  crown.scale.y = 0.8;
  g.add(crown);
  const flowers = new THREE.Group();
  flowers.name = 'flowers';
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4;
    const up = 0.45 + ((i * 7) % 5) / 10;
    flowers.add(mesh(new THREE.IcosahedronGeometry(0.09, 0), s.flower, Math.cos(a) * s.height * 0.3 * (1.1 - up * 0.4), s.height * (0.45 + up * 0.35), Math.sin(a) * s.height * 0.3 * (1.1 - up * 0.4)));
  }
  g.add(flowers);
  return g;
}

/** A tūī: glossy dark body with the white throat tuft. */
function buildTui(): THREE.Group {
  const body = mesh(new THREE.SphereGeometry(0.13, 10, 8), '#1f3b4d');
  body.scale.set(1, 0.95, 1.3);
  const g = new THREE.Group().add(body, mesh(new THREE.SphereGeometry(0.08, 8, 6), '#1f3b4d', 0, 0.1, 0.12), mesh(new THREE.SphereGeometry(0.03, 6, 5), '#ffffff', 0, 0.04, 0.17), mesh(new THREE.ConeGeometry(0.02, 0.08, 5).rotateX(Math.PI / 2), '#1b1b1f', 0, 0.1, 0.22));
  g.scale.setScalar(1.6);
  return g;
}
