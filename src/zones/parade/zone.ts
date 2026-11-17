import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import type { Character } from '../../character/character';
import { best, burst, controls, disposeTree, fitDistance, frame, helper, markCursor, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Float Your Boat: build a float for the Santa Parade, then roll it down main street past
 * the crowd. Today's theme is seeded by the date. The crowd cheers for floats that fit the
 * theme, have plenty of variety and look balanced from the footpath.
 */
const SLOT = 1.15;
const SLOTS = [v3(-SLOT, 0, -SLOT / 2), v3(0, 0, -SLOT / 2), v3(SLOT, 0, -SLOT / 2), v3(-SLOT, 0, SLOT / 2), v3(0, 0, SLOT / 2), v3(SLOT, 0, SLOT / 2)];
const DECK = 0.72;

type Tag = 'christmas' | 'summer' | 'native';
interface Part { id: string; name: string; tags: Tag[]; height: number; build: () => Promise<THREE.Object3D> }

const prop = (path: string, opts: { width?: number; height?: number }) => async () => (await spawnProp(path, opts)).object;
const PARTS: Part[] = [
  { id: 'tree', name: 'Christmas tree', tags: ['christmas'], height: 1.6, build: prop('holiday/christmas_tree_decorated', { height: 1.6 }) },
  { id: 'presents', name: 'Presents', tags: ['christmas'], height: 0.6, build: prop('holiday/present_A_red', { height: 0.6 }) },
  { id: 'train', name: 'Toy train', tags: ['christmas'], height: 0.7, build: prop('holiday/train_locomotive', { width: 0.95 }) },
  { id: 'lantern', name: 'Lantern', tags: ['christmas'], height: 1.3, build: prop('holiday/lantern', { height: 1.3 }) },
  { id: 'pohutukawa', name: 'Pōhutukawa', tags: ['native', 'christmas'], height: 1.5, build: async () => { const g = (await spawnProp('forest/Tree_2_A_Color1', { height: 1.5 })).object; for (let i = 0; i < 14; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), '#d7263d', Math.cos(i * 2.4) * 0.35, 0.9 + (i % 4) * 0.12, Math.sin(i * 2.4) * 0.35)); return g; } },
  { id: 'kiwi', name: 'Giant kiwi', tags: ['native'], height: 0.9, build: async () => { const g = new THREE.Group(); const b = mesh(new THREE.SphereGeometry(0.38, 14, 10), '#7a5a3a', 0, 0.42, 0); b.scale.set(1, 0.9, 1.2); g.add(b, mesh(new THREE.SphereGeometry(0.16, 10, 8), '#7a5a3a', 0, 0.6, 0.4), mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.45, 6).rotateX(1.3), '#e9d9b0', 0, 0.52, 0.72)); for (const x of [-0.12, 0.12]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), '#e9d9b0', x, 0.08, 0.05)); return g; } },
  { id: 'tui', name: 'Giant tūī', tags: ['native'], height: 1.0, build: async () => { const g = new THREE.Group(); const b = mesh(new THREE.SphereGeometry(0.3, 14, 10), '#1f3b4d', 0, 0.55, 0); b.scale.set(1, 1.1, 1.3); g.add(b, mesh(new THREE.SphereGeometry(0.18, 10, 8), '#1f3b4d', 0, 0.85, 0.22), mesh(new THREE.SphereGeometry(0.07, 8, 6), '#ffffff', 0, 0.72, 0.36), mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), '#3b2a1a', 0, 0.15, 0)); return g; } },
  { id: 'pav', name: 'Giant pav', tags: ['summer', 'christmas'], height: 0.6, build: async () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.36, 20), '#fbf6ea', 0, 0.18, 0), mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.1, 20), '#fffdf6', 0, 0.4, 0)); for (let i = 0; i < 8; i++) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10), i % 2 ? '#7cb342' : '#d7263d', Math.cos(i * 0.8) * 0.24, 0.47, Math.sin(i * 0.8) * 0.24)); return g; } },
  { id: 'jandal', name: 'Giant jandal', tags: ['summer'], height: 0.4, build: async () => { const g = new THREE.Group(); const s = new THREE.Shape(); s.absellipse(0, 0, 0.3, 0.5, 0, Math.PI * 2); const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.1, 0), new THREE.MeshLambertMaterial({ color: '#27c4f5' })); g.add(sole); for (const x of [-1, 1]) { const strap = mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 12, Math.PI), '#d7263d', x * 0.06, 0.12, -0.05); strap.rotation.y = x * 0.6; g.add(strap); } g.rotation.y = 0.4; return g; } },
  { id: 'surfboard', name: 'Surfboard', tags: ['summer'], height: 1.6, build: async () => { const b = mesh(new THREE.SphereGeometry(1, 14, 8), '#ff7a1a', 0, 0.8, 0); b.scale.set(0.24, 0.8, 0.05); return new THREE.Group().add(b); } },
  { id: 'chilly', name: 'Chilly bin', tags: ['summer'], height: 0.55, build: async () => new THREE.Group().add(mesh(new THREE.BoxGeometry(0.8, 0.42, 0.5), '#1e73d8', 0, 0.21, 0), mesh(new THREE.BoxGeometry(0.82, 0.1, 0.52), '#f4f7fb', 0, 0.47, 0)) },
  { id: 'umbrella', name: 'Beach umbrella', tags: ['summer'], height: 1.6, build: async () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), '#e9e4d8', 0, 0.75, 0)); const top = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.3, 10, 1, true), new THREE.MeshLambertMaterial({ color: '#ffd23f', side: THREE.DoubleSide })); top.position.y = 1.5; g.add(top); return g; } },
];

const THEMES: { tag: Tag; name: string }[] = [
  { tag: 'christmas', name: 'A Kiwi Christmas' },
  { tag: 'summer', name: 'Summer at the beach' },
  { tag: 'native', name: 'Our native birds and trees' },
];

type Phase = 'idle' | 'build' | 'parade' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const float = buildTrailer();
  root.add(float);
  const deck = new THREE.Group();
  deck.position.y = DECK;
  float.add(deck);
  const confetti = burst(120);
  root.add(confetti.object);
  const crowd: Character[] = await Promise.all([0, 1, 2, 3].map((i) => helper(ctx, i)));
  // The crowd lines the far footpath of main street (world z ≈ 23; this zone sits 25 m north).
  crowd.forEach((c, i) => {
    c.root.position.set(14 + i * 7, 0, 25.4);
    c.root.rotation.y = Math.PI;
    c.play('Idle_B');
  });

  // -- State -------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let theme = THEMES[0];
  let slots: (Part | null)[] = SLOTS.map(() => null);
  let slotObjects: (THREE.Object3D | null)[] = SLOTS.map(() => null);
  let t = 0;
  let result = { score: 0, stars: 0, notes: [] as string[] };
  let auto = false;
  let bound: ReturnType<typeof pointer> | null = null;

  const sheetEl = document.createElement('div');
  const render = () => {
    ui.subtitle(`Theme: ${theme.name}`);
    ui.stats([{ label: 'On board', value: `${slots.filter(Boolean).length}/6` }]);
    sheetEl.innerHTML = `
      <div class="puzzle">Today’s theme: <b>${theme.name}</b>. Pick parts to fill the float. Tap a part on the float to take it off.</div>
      <div class="pick-row">${PARTS.map((p) => `<button class="pick" data-p="${p.id}"><b>${p.name}</b><small>${p.tags.join(' · ')}</small></button>`).join('')}</div>
      <button class="btn btn-primary btn-wide" data-go ${slots.some(Boolean) ? '' : 'disabled'}>Start the parade</button>`;
    sheetEl.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => void addPart(PARTS.find((p) => p.id === b.dataset.p)!)));
    sheetEl.querySelector('[data-go]')!.addEventListener('click', () => go());
    ui.sheet(sheetEl);
    markCursor(sheetEl.querySelectorAll('[data-p]'), partCursor);
  };

  // -- Keyboard/gamepad: left/right (or LB/RB) choose a part, A adds it, X takes the last one
  // off, Y / Start starts the parade. --------------------------------------------------------
  let partCursor = 0;
  const padInput = () => {
    const input = ctx.input;
    const move = input.nav().x + (input.pressed('rb') ? 1 : 0) - (input.pressed('lb') ? 1 : 0);
    if (move) {
      partCursor = (partCursor + move + PARTS.length) % PARTS.length;
      markCursor(sheetEl.querySelectorAll('[data-p]'), partCursor);
    }
    if (input.confirm()) void addPart(PARTS[partCursor]);
    if (input.pressed('west') || input.keyPressed('Backspace', 'Delete', 'KeyX')) {
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i]) {
          removeAt(i);
          break;
        }
      }
    }
    if (input.pressed('north') || input.pressed('start') || input.keyPressed('Enter')) go();
  };

  const addPart = async (p: Part) => {
    const i = slots.findIndex((s) => !s);
    if (i < 0 || phase !== 'build') return ui.toast('Float’s full. Tap a part to take it off', 'info');
    slots[i] = p;
    const o = await p.build();
    o.position.copy(SLOTS[i]);
    deck.add(o);
    slotObjects[i] = o;
    render();
  };
  const removeAt = (i: number) => {
    if (!slots[i]) return;
    deck.remove(slotObjects[i]!);
    slots[i] = null;
    slotObjects[i] = null;
    render();
  };

  const judge = () => {
    const parts = slots.filter(Boolean) as Part[];
    const notes: string[] = [];
    const fit = parts.filter((p) => p.tags.includes(theme.tag)).length;
    const variety = new Set(parts.map((p) => p.id)).size;
    // Balance: the left and right of the float should be about the same height.
    const side = (cols: number[]) => cols.reduce((a, c) => a + (slots[c]?.height ?? 0) + (slots[c + 3]?.height ?? 0), 0);
    const tilt = Math.abs(side([0]) - side([2]));
    let score = fit * 3 + variety + (parts.length === 6 ? 2 : 0) + (tilt < 0.8 ? 3 : 0);
    notes.push(fit === parts.length ? 'Every part fits the theme.' : `${fit} of ${parts.length} parts fit the theme.`);
    if (variety < parts.length) notes.push('The judges spotted a few doubles.');
    if (tilt < 0.8) notes.push('Nicely balanced from the footpath.');
    else notes.push('A bit lopsided: one side towers over the other.');
    score = Math.max(0, score);
    const stars = Math.max(1, Math.min(5, Math.round(score / 5.6)));
    return { score, stars, notes };
  };

  const go = () => {
    if (phase !== 'build' || !slots.some(Boolean)) return;
    phase = 'parade';
    result = judge();
    t = 0;
    ui.sheet(null);
    ui.hint(null);
    crowd.forEach((c) => c.play('Idle_A'));
  };

  // The route: out of the green (+Z), then east along main street.
  const route = (k: number, out: THREE.Vector3) => {
    const a = THREE.MathUtils.clamp(k / 0.35, 0, 1);
    const b = THREE.MathUtils.clamp((k - 0.35) / 0.65, 0, 1);
    out.set(3 + b * 40, 0, a * 20.7);
    return out;
  };

  const finish = () => {
    phase = 'done';
    const b = best('parade', ctx.seed, result.score);
    ui.end(
      {
        title: ['', 'A brave effort', 'The crowd clapped', 'Big cheers!', 'Crowd favourite!', 'Best float in the parade!'][result.stars],
        score: `${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}`,
        grid: (slots.filter(Boolean) as Part[]).map((p) => ({ label: p.name, tone: p.tags.includes(theme.tag) ? 'good' : 'neutral' })),
        shareGrid: '⭐'.repeat(result.stars),
        note: `${result.notes.join(' ')}${b > result.score ? ` Best today: ${b} pts.` : ''}`,
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  const reset = () => {
    slotObjects.forEach((o) => o && deck.remove(o));
    slots = SLOTS.map(() => null);
    slotObjects = SLOTS.map(() => null);
    float.position.set(0, 0, 0);
    float.rotation.y = 0;
  };

  const zone: GameZone = {
    start() {
      reset();
      const rng = mulberry32(hashString(`parade:${ctx.seed}`));
      theme = THEMES[Math.floor(rng() * THEMES.length)];
      phase = 'build';
      ctx.player.place(v3(-2.6, 0, 1.8), Math.PI * 0.8);
      const d = fitDistance(ctx, 5, 4);
      frame(ctx, v3(1.5, 1.2 + d * 0.6, d * 0.8), v3(0, 0.9, 0), 3.2, false);
      partCursor = 0;
      ui.hint(controls({
        touch: 'Tap parts to load the float. Tap a part on the float to take it off.',
        keyboard: 'Choose with {←} {→}, {Space} adds it, {X} takes the last one off, {Enter} starts the parade.',
        pad: 'Choose with the left stick, {A} adds it, {X} takes the last one off, {Y} starts the parade.',
      }));
      bound = pointer(ctx, {
        planeY: DECK,
        tap: (p) => {
          if (phase !== 'build' || !p.ground) return;
          const i = SLOTS.findIndex((s) => s.distanceTo(v3(p.ground!.x, 0, p.ground!.z)) < 0.6);
          if (i >= 0) removeAt(i);
        },
      });
      render();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
      reset();
    },
    update(dt, elapsed) {
      confetti.update(dt);
      if (!auto && phase === 'build') padInput();
      if (auto && phase === 'build') {
        if (slots.every(Boolean)) go();
        else if (!slots.some(Boolean)) {
          const pick = PARTS.filter((p) => p.tags.includes(theme.tag));
          const order = [0, 2, 1, 3, 5, 4].map((i) => pick[i % pick.length]);
          void (async () => {
            for (const p of order) await addPart(p);
          })();
        }
      }
      if (phase !== 'parade') return;
      t += dt;
      const k = Math.min(1, t / 14);
      const p = route(k, v3());
      const ahead = route(Math.min(1, k + 0.01), v3());
      float.position.copy(p);
      if (ahead.distanceTo(p) > 0.001) float.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z) - Math.PI / 2;
      float.position.y = Math.abs(Math.sin(elapsed * 6)) * 0.03;
      deck.rotation.z = Math.sin(elapsed * 3) * 0.02;
      // Chase the float down the street.
      const cam = p.clone().add(v3(-2, 4.5, -7));
      frame(ctx, cam, p.clone().add(v3(1.5, 0.8, 0)), 3);
      for (const c of crowd) {
        const near = Math.abs(c.root.position.x - p.x) < 5 && k > 0.35;
        if (near && c.animation !== 'Cheering' && c.animation !== 'Waving') c.play(result.stars >= 3 ? 'Cheering' : 'Waving');
      }
      if (k > 0.4 && Math.random() < dt * result.stars * 0.6) confetti.fire(p.clone().add(v3(0, 2.4, 0)), 0.5);
      if (k >= 1 && t > 15) finish();
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, theme: theme.tag, parts: slots.map((s) => s?.id ?? null), score: result.score }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 150));
        auto = false;
      },
    },
  };
  return zone;
}

function buildTrailer(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(3.7, 0.18, 2.5), '#c9995a', 0, 0.63, 0));
  // Skirt of tinsel-coloured bunting around the deck.
  const colours = ['#d7263d', '#ffd23f', '#27c4f5', '#3e8e4e'];
  for (let i = 0; i < 12; i++) {
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.35, 0.03), colours[i % 4], -1.65 + i * 0.3, 0.38, 1.26));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.35, 0.03), colours[(i + 2) % 4], -1.65 + i * 0.3, 0.38, -1.26));
  }
  for (const [x, z] of [[-1.2, -1.1], [1.2, -1.1], [-1.2, 1.1], [1.2, 1.1]]) {
    const w = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 14), '#1f2228', x, 0.28, z);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 1), '#3b3f46', 2.3, 0.45, 0));
  return g;
}
