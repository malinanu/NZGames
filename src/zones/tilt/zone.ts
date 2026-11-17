import * as THREE from 'three';
import { best, controls, disposeTree, fitDistance, frame, mesh, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Tilt! A tabletop orrery at the lighthouse lookout. Move Earth round the Sun (month) and lean
 * its axis (tilt), and watch what happens to Aotearoa and to London. Each puzzle can only be
 * solved by changing the real cause of the seasons, the tilt, not the distance to the Sun.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORBIT = 1.7;
const PLACES = { nz: { name: 'Aotearoa', lat: -41 }, uk: { name: 'London', lat: 51.5 }, north: { name: 'Far north (70°N)', lat: 70 } };

interface Puzzle {
  ask: string;
  learn: string;
  solved: (tilt: number, month: number) => boolean;
  /** A setting that solves it (for the test bot). */
  answer: [number, number];
}

const PUZZLES: Puzzle[] = [
  {
    ask: 'Earth really leans about <b>23°</b>. Set the real tilt and make it <b>December</b>. Is Christmas hot in Aotearoa?',
    learn: 'In December the south leans towards the Sun: long days and high midday sun in Aotearoa, short dark days in London. Same Christmas, opposite seasons.',
    solved: (t, m) => Math.abs(t - 23) <= 2 && m === 11,
    answer: [23, 11],
  },
  {
    ask: 'Now make Christmas <b>cold</b> in Aotearoa, without changing the month.',
    learn: 'Lean the axis the other way and the seasons swap. Distance to the Sun barely matters: Earth is actually closest to the Sun in early January.',
    solved: (t, m) => m === 11 && solar(t, m, PLACES.nz.lat).noon < 40,
    answer: [-23, 11],
  },
  {
    ask: 'Make a world with <b>no seasons</b>: Aotearoa gets the same daylight in June and December.',
    learn: 'With no tilt, the Sun is overhead at the equator all year. Every day is 12 hours long and every month feels the same.',
    solved: (t) => Math.abs(t) <= 1,
    answer: [0, 5],
  },
  {
    ask: 'Give the <b>far north</b> the midnight sun: 24 hours of daylight.',
    learn: 'When the north leans hard towards the Sun, places near the pole never see it set. That is June up there, and the reason our midwinter is their midsummer.',
    solved: (t, m) => solar(t, m, PLACES.north.lat).day >= 24,
    answer: [23, 5],
  },
  {
    ask: 'Matariki rises before dawn in our <b>midwinter</b>. Set the real tilt and find the month when Aotearoa has its shortest days.',
    learn: 'Late June: the south leans away from the Sun, our days are shortest, and Matariki marks the start of the Māori new year.',
    solved: (t, m) => Math.abs(t - 23) <= 2 && (m === 5 || m === 6),
    answer: [23, 5],
  },
];

/** Midday sun height (degrees) and hours of daylight at a latitude. */
function solar(tilt: number, month: number, lat: number): { noon: number; day: number; decl: number } {
  // Sun's declination: +tilt at the June solstice (~21 June), -tilt in December.
  const dayOfYear = month * 30.4 + 15;
  const decl = tilt * Math.cos(((dayOfYear - 172) / 365) * Math.PI * 2);
  const noon = 90 - Math.abs(lat - decl);
  const x = -Math.tan(THREE.MathUtils.degToRad(lat)) * Math.tan(THREE.MathUtils.degToRad(decl));
  const day = x <= -1 ? 24 : x >= 1 ? 0 : (24 / Math.PI) * Math.acos(x);
  return { noon: Math.max(noon, 0), day, decl };
}

function season(lat: number, s: { noon: number; day: number }): string {
  if (s.day >= 23.9) return 'Midnight sun';
  if (s.day <= 0.1) return 'Polar night';
  const warmth = s.noon + (s.day - 12) * 3;
  const south = lat < 0;
  void south;
  return warmth > 62 ? 'Summer' : warmth > 42 ? 'Mild' : 'Winter';
}

type Phase = 'idle' | 'play' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;

  // -- The orrery on its table ---------------------------------------------------------
  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.1, 40), '#7a5a3a', 0, 0.9, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.9, 10), '#5b4229', 0, 0.45, 0));
  table.position.set(0, 0, -1.2);
  root.add(table);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  sun.position.set(0, 1.6, 0);
  table.add(sun);
  const glow = new THREE.PointLight('#fff1c4', 6, 6, 1.5);
  glow.position.copy(sun.position);
  table.add(glow);
  const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(ORBIT, 0.01, 6, 90), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
  orbitRing.rotation.x = Math.PI / 2;
  orbitRing.position.y = 1.6;
  table.add(orbitRing);
  // Month markers round the orbit.
  for (let m = 0; m < 12; m++) {
    const a = orbitAngle(m);
    table.add(mesh(new THREE.SphereGeometry(m === 11 || m === 5 ? 0.05 : 0.025, 8, 6), m === 11 ? '#d7263d' : m === 5 ? '#27c4f5' : '#fbfbf6', Math.cos(a) * ORBIT, 1.6, Math.sin(a) * ORBIT));
  }

  // Earth: a tilt pivot (fixed in space while it orbits) and a spinning globe inside it.
  const earthPos = new THREE.Group();
  table.add(earthPos);
  const tiltPivot = new THREE.Group();
  earthPos.add(tiltPivot);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9 }));
  tiltPivot.add(globe);
  tiltPivot.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.95, 6), '#fbfbf6'));
  const equator = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.004, 4, 48), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  equator.rotation.x = Math.PI / 2;
  tiltPivot.add(equator);
  const marker = (lat: number, colour: string) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: colour }));
    const r = THREE.MathUtils.degToRad(lat);
    m.position.set(Math.cos(r) * 0.31, Math.sin(r) * 0.31, 0);
    globe.add(m);
  };
  marker(PLACES.nz.lat, '#d7263d');
  marker(PLACES.uk.lat, '#27c4f5');

  // -- State ----------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let tilt = 0;
  /** Unrounded tilt while it is steered with a stick or held key. */
  let tiltF = 0;
  let month = 6;
  let puzzle = 0;
  let tries = 0;
  let solvedLog: number[] = [];
  let shown = 0;
  let auto = false;

  const sheetEl = document.createElement('div');
  sheetEl.innerHTML = `
    <div class="puzzle" data-ask></div>
    <div class="slider"><label for="tilt-month">Month <span data-month></span></label><input id="tilt-month" type="range" min="0" max="11" step="1"></div>
    <div class="slider"><label for="tilt-tilt">Tilt <span data-tilt></span></label><input id="tilt-tilt" type="range" min="-45" max="45" step="1"></div>
    <div class="readout"><div data-nz></div><div data-uk></div></div>
    <button class="btn btn-primary btn-wide" data-check>Check</button>`;
  const monthIn = sheetEl.querySelector<HTMLInputElement>('#tilt-month')!;
  const tiltIn = sheetEl.querySelector<HTMLInputElement>('#tilt-tilt')!;
  monthIn.addEventListener('input', () => set(tilt, Number(monthIn.value)));
  tiltIn.addEventListener('input', () => set(Number(tiltIn.value), month));
  sheetEl.querySelector('[data-check]')!.addEventListener('click', () => check());

  const describe = (key: 'nz' | 'uk') => {
    const p = PLACES[key];
    const s = solar(tilt, month, p.lat);
    return `${p.name}<b>${season(p.lat, s)}</b>${s.day.toFixed(1)} h of daylight · midday sun ${Math.round(s.noon)}°`;
  };

  const set = (t: number, m: number) => {
    tilt = THREE.MathUtils.clamp(Math.round(t), -45, 45);
    month = THREE.MathUtils.clamp(Math.round(m), 0, 11);
    monthIn.value = String(month);
    tiltIn.value = String(tilt);
    sheetEl.querySelector('[data-month]')!.textContent = MONTHS[month];
    sheetEl.querySelector('[data-tilt]')!.textContent = `${tilt}°`;
    sheetEl.querySelector('[data-nz]')!.innerHTML = describe('nz');
    sheetEl.querySelector('[data-uk]')!.innerHTML = describe('uk');
    // The axis always leans the same way in space (towards +X here), whatever the month.
    tiltPivot.rotation.z = -THREE.MathUtils.degToRad(tilt);
  };

  const hud = () => {
    ui.subtitle(`Puzzle ${Math.min(puzzle + 1, PUZZLES.length)} of ${PUZZLES.length}`);
    ui.stats([{ label: 'Solved', value: `${solvedLog.length}/${PUZZLES.length}` }]);
  };

  const showPuzzle = () => {
    sheetEl.querySelector('[data-ask]')!.innerHTML = PUZZLES[puzzle].ask;
    (sheetEl.querySelector('[data-check]') as HTMLButtonElement).textContent = 'Check';
    tries = 0;
    hud();
  };

  let awaitingNext = false;
  const check = () => {
    if (phase !== 'play') return;
    if (awaitingNext) {
      awaitingNext = false;
      puzzle++;
      if (puzzle >= PUZZLES.length) return finish();
      return showPuzzle();
    }
    const p = PUZZLES[puzzle];
    tries++;
    if (p.solved(tilt, month)) {
      solvedLog.push(tries);
      ctx.player.character.play('Cheering');
      sheetEl.querySelector('[data-ask]')!.innerHTML = `<b>Yes!</b> ${p.learn}`;
      (sheetEl.querySelector('[data-check]') as HTMLButtonElement).textContent = puzzle + 1 >= PUZZLES.length ? 'Finish' : 'Next puzzle';
      awaitingNext = true;
      hud();
    } else {
      ui.toast(tries > 2 ? 'Hint: it’s the tilt that matters' : 'Not quite. Watch the readouts', 'info');
    }
  };

  const finish = () => {
    phase = 'done';
    ui.sheet(null);
    const firstTime = solvedLog.filter((t) => t === 1).length;
    const b = best('tilt', 'all', firstTime);
    ui.end(
      {
        title: 'You tilted the world',
        score: `${firstTime}/${PUZZLES.length} first try`,
        grid: solvedLog.map((t, i) => ({ label: `Puzzle ${i + 1}`, tone: t === 1 ? 'great' : 'good' })),
        shareGrid: solvedLog.map((t) => (t === 1 ? '🌏' : '🌗')).join(''),
        extra: '<div class="puzzle"><b>The big idea:</b> seasons come from Earth’s 23° lean, not from how close we are to the Sun. That is why Christmas in Aotearoa is a beach day.</div>',
        note: b > firstTime ? `Your best: ${b} first try` : '',
      },
      'lookout',
    );
  };

  const zone: GameZone = {
    start() {
      phase = 'play';
      puzzle = 0;
      solvedLog = [];
      awaitingNext = false;
      ctx.player.place(v3(-1.6, 0, 1.6), Math.PI * 0.85);
      const d = fitDistance(ctx, 5.2, 4.6);
      frame(ctx, v3(0, 1.6 + d * 0.55, -1.2 + d * 0.8), v3(0, 1.3, -1.2), 3.2, false);
      ui.sheet(sheetEl);
      set(0, 6);
      tiltF = 0;
      showPuzzle();
      ui.hint(controls({
        touch: 'Slide the month and the tilt, then check.',
        keyboard: 'Tilt with {←} {→}, month with {↑} {↓}, {Space} to check.',
        pad: 'Tilt with the left stick, month with {LB} {RB} or up and down, {A} to check.',
      }));
    },
    stop() {
      auto = false;
      phase = 'idle';
      ui.sheet(null);
    },
    update(dt, elapsed) {
      // Glide Earth towards the chosen month; spin it so day and night sweep round.
      const target = orbitAngle(month);
      let d = target - shown;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      shown += d * Math.min(1, dt * 4);
      earthPos.position.set(Math.cos(shown) * ORBIT, 1.6, Math.sin(shown) * ORBIT);
      globe.rotation.y = elapsed * 0.8;
      if (!auto && phase === 'play') {
        // Keyboard/gamepad: stick x leans the axis smoothly; up/down or LB/RB step the month.
        const input = ctx.input;
        const x = input.stick().x;
        if (x) {
          if (Math.abs(tiltF - tilt) >= 1) tiltF = tilt;
          tiltF = THREE.MathUtils.clamp(tiltF + x * 30 * dt, -45, 45);
          set(tiltF, month);
        }
        const m = input.nav().y + (input.pressed('rb') ? 1 : 0) - (input.pressed('lb') ? 1 : 0);
        if (m) set(tilt, (month + m + 12) % 12);
        if (input.confirm() || input.keyPressed('Enter')) check();
      }
      if (auto && phase === 'play') {
        if (awaitingNext) check();
        else {
          const [t, m] = PUZZLES[puzzle].answer;
          set(t, m);
          check();
        }
      }
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, puzzle, tilt, month, solved: solvedLog.length }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 250));
        auto = false;
      },
    },
  };
  set(23, 11);
  return zone;
}

/** Where Earth sits on its orbit in a month. The axis leans towards +X, so the north is
 *  tipped towards the Sun when Earth is at -X (June) and away at +X (December). */
function orbitAngle(month: number): number {
  return Math.PI + ((month - 5.67) / 12) * Math.PI * 2;
}

function earthTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f6fb0';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#4f9a45';
  // Very rough continents, recognisable at this size.
  const blobs: [number, number, number, number][] = [[60, 40, 34, 22], [70, 82, 16, 26], [130, 38, 40, 20], [140, 70, 18, 24], [190, 40, 40, 18], [212, 88, 18, 12], [244, 98, 5, 8]];
  for (const [x, y, w, h] of blobs) {
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#f4f7fb';
  g.fillRect(0, 0, 256, 7);
  g.fillRect(0, 121, 256, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
