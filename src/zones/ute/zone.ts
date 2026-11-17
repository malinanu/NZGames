import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { hashString, mulberry32, nzDateLabel, shuffle } from '../../shared/rng';
import { best, burst, disposeTree, fitDistance, frame, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Pack the Ute in the bach driveway. Everything for Christmas at the beach won't fit, so pick
 * and pack: tap an item, tap the tray to drop it, tap the turn button to rotate. Then hit the
 * gravel road. Anything fragile in the back row breaks; loose things in the back row may
 * bounce out. Score is the value of what arrives in one piece.
 */
const COLS = 4;
const ROWS = 6;
const CELL = 0.46;
const TRAY_Y = 0.92;

interface ItemType {
  id: string;
  name: string;
  w: number;
  d: number;
  value: number;
  fragile?: boolean;
  heavy?: boolean;
  build: () => Promise<THREE.Object3D>;
}

const boxy = (w: number, h: number, d: number, colour: string, top?: string) => async () => {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, d), colour, 0, h / 2, 0));
  if (top) g.add(mesh(new THREE.BoxGeometry(w * 1.02, h * 0.18, d * 1.02), top, 0, h - h * 0.09, 0));
  return g;
};
const prop = (path: string, opts: { width?: number; height?: number }, rot = 0) => async () => {
  const p = await spawnProp(path, opts);
  p.object.rotation.y = rot;
  return new THREE.Group().add(p.object);
};

const ITEMS: ItemType[] = [
  { id: 'chilly', name: 'Chilly bin', w: 2, d: 2, value: 6, heavy: true, build: boxy(0.85, 0.5, 0.82, '#1e73d8', '#f4f7fb') },
  { id: 'tree', name: 'Christmas tree', w: 1, d: 4, value: 7, build: async () => { const p = await spawnProp('holiday/christmas_tree', { height: 1.75 }); p.object.rotation.x = -Math.PI / 2; p.object.position.set(0, 0.32, 0.85); return new THREE.Group().add(p.object); } },
  { id: 'pav', name: 'The pav', w: 1, d: 1, value: 6, fragile: true, build: async () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 14), '#fbfbf6', 0, 0.06, 0), mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), '#d7263d', 0.05, 0.14, 0), mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), '#7cb342', -0.05, 0.14, 0.03)); return g; } },
  { id: 'presents', name: 'Presents', w: 1, d: 1, value: 3, build: prop('holiday/present_A_red', { width: 0.36 }) },
  { id: 'presents2', name: 'More presents', w: 2, d: 1, value: 4, build: async () => { const g = new THREE.Group(); for (const [x, m] of [[-0.22, 'holiday/present_B_blue'], [0.22, 'holiday/present_C_green']] as [number, string][]) { const p = await spawnProp(m, { width: 0.36 }); p.object.position.x = x; g.add(p.object); } return g; } },
  { id: 'boogie', name: 'Boogie boards', w: 1, d: 3, value: 3, build: boxy(0.38, 0.12, 1.25, '#ff7a1a', '#27c4f5') },
  { id: 'guitar', name: 'Guitar', w: 1, d: 3, value: 4, fragile: true, build: prop('mixedbag1/guitar_A', { height: 1.2 }, 0) },
  { id: 'chairs', name: 'Deck chairs', w: 2, d: 2, value: 3, build: prop('furniture/chair_A_wood', { height: 0.75 }) },
  { id: 'gas', name: 'BBQ gas', w: 1, d: 1, value: 3, heavy: true, build: async () => new THREE.Group().add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.48, 12), '#9aa0a8', 0, 0.24, 0)) },
  { id: 'umbrella', name: 'Beach umbrella', w: 1, d: 4, value: 2, build: boxy(0.2, 0.2, 1.7, '#e8578e') },
  { id: 'ball', name: 'Cricket gear', w: 2, d: 1, value: 2, build: prop('city/trash_A', { height: 0.5 }) },
  { id: 'dogbed', name: "Dog's bed", w: 2, d: 2, value: 4, build: boxy(0.8, 0.22, 0.8, '#8a5a33', '#c9995a') },
];

interface Placed {
  type: ItemType;
  col: number;
  row: number;
  w: number;
  d: number;
  object: THREE.Object3D;
}

type Phase = 'idle' | 'pack' | 'drive' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;

  // -- The ute ------------------------------------------------------------------------
  const ute = buildUte();
  root.add(ute);
  const tray = new THREE.Group();
  tray.position.set(-((COLS - 1) / 2) * CELL, TRAY_Y, -0.2);
  ute.add(tray);
  const cellMeshes: THREE.Mesh[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92), new THREE.MeshBasicMaterial({ color: r === ROWS - 1 ? '#ffd9b0' : '#ffffff', transparent: true, opacity: 0.35 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(c * CELL, 0.01, r * CELL);
      m.visible = false;
      tray.add(m);
      cellMeshes.push(m);
    }
  }
  const dust = burst(60, ['#c9b48a', '#b39d73', '#e0d2b0'], 0.16);
  root.add(dust.object);

  // -- State -------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let load: ItemType[] = [];
  let placed: Placed[] = [];
  let selected: ItemType | null = null;
  let rotated = false;
  let driveT = 0;
  let results: { type: ItemType; ok: boolean; why?: string }[] = [];
  let bound: ReturnType<typeof pointer> | null = null;

  const grid = () => {
    const g: (Placed | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (const p of placed) for (let r = p.row; r < p.row + p.d; r++) for (let c = p.col; c < p.col + p.w; c++) g[r][c] = p;
    return g;
  };
  const fits = (w: number, d: number, col: number, row: number) => {
    if (col < 0 || row < 0 || col + w > COLS || row + d > ROWS) return false;
    const g = grid();
    for (let r = row; r < row + d; r++) for (let c = col; c < col + w; c++) if (g[r][c]) return false;
    return true;
  };
  const dims = (t: ItemType) => (rotated ? { w: t.d, d: t.w } : { w: t.w, d: t.d });

  const place = async (t: ItemType, col: number, row: number, w: number, d: number) => {
    const object = await t.build();
    object.position.set((col + (w - 1) / 2) * CELL, 0, (row + (d - 1) / 2) * CELL);
    if (w !== t.w) object.rotation.y = Math.PI / 2;
    tray.add(object);
    placed.push({ type: t, col, row, w, d, object });
    selected = null;
    rotated = false;
    sheet();
  };
  const remove = (p: Placed) => {
    tray.remove(p.object);
    placed = placed.filter((q) => q !== p);
    sheet();
  };

  const used = () => placed.reduce((a, p) => a + p.w * p.d, 0);
  const hud = () => {
    ui.subtitle(phase === 'drive' ? 'Down the gravel road…' : `${used()} of ${COLS * ROWS} spaces used`);
    ui.stats([{ label: 'Packed', value: String(placed.reduce((a, p) => a + p.type.value, 0)) }]);
  };

  const sheetEl = document.createElement('div');
  const sheet = () => {
    hud();
    const left = load.filter((t) => !placed.some((p) => p.type === t));
    sheetEl.innerHTML = `
      <div class="pick-row">${left
        .map((t) => `<button class="pick ${selected === t ? 'on' : ''}" data-id="${t.id}" aria-pressed="${selected === t}"><b>${t.name}</b><small>${t.w}×${t.d}${t.fragile ? ' · fragile' : ''}${t.heavy ? ' · heavy' : ''} · ${t.value} pts</small></button>`)
        .join('')}</div>
      <div class="tool-row two">
        <button class="btn" data-rot ${selected ? '' : 'disabled'}>Turn it</button>
        <button class="btn btn-primary" data-go ${placed.length ? '' : 'disabled'}>Hit the road</button>
      </div>`;
    sheetEl.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) =>
      b.addEventListener('click', () => {
        selected = load.find((t) => t.id === b.dataset.id) ?? null;
        rotated = false;
        sheet();
        showFootprint();
      }),
    );
    sheetEl.querySelector('[data-rot]')?.addEventListener('click', () => {
      rotated = !rotated;
      sheet();
      showFootprint();
    });
    sheetEl.querySelector('[data-go]')?.addEventListener('click', () => drive());
    ui.sheet(sheetEl);
  };
  const showFootprint = () => cellMeshes.forEach((m) => (m.visible = phase === 'pack'));

  const cellAt = (local: THREE.Vector3) => {
    const p = tray.worldToLocal(root.localToWorld(local.clone()));
    return { col: Math.round(p.x / CELL), row: Math.round(p.z / CELL) };
  };

  const tapTray = async (local: THREE.Vector3 | null) => {
    if (phase !== 'pack' || !local) return;
    const { col, row } = cellAt(local);
    const occupant = grid()[row]?.[col];
    if (occupant) return remove(occupant);
    if (!selected) return ui.toast('Pick something to pack first', 'info');
    const { w, d } = dims(selected);
    // Centre the item on the tapped cell where possible.
    const c0 = Math.min(Math.max(0, col - Math.floor((w - 1) / 2)), COLS - w);
    const r0 = Math.min(Math.max(0, row - Math.floor((d - 1) / 2)), ROWS - d);
    if (!fits(w, d, c0, r0)) return ui.toast("Won't fit there. Turn it or move something", 'bad');
    await place(selected, c0, r0, w, d);
  };

  const drive = () => {
    if (phase !== 'pack') return;
    phase = 'drive';
    driveT = 0;
    ui.sheet(null);
    ui.hint(null);
    cellMeshes.forEach((m) => (m.visible = false));
    const rng = mulberry32(hashString(`ute-road:${ctx.seed}`));
    results = placed.map((p) => {
      const back = p.row + p.d - 1 === ROWS - 1;
      if (p.type.fragile && back) return { type: p.type, ok: false, why: 'broke in the back row' };
      if (back && !p.type.heavy && rng() < 0.5) return { type: p.type, ok: false, why: 'bounced out on the gravel' };
      return { type: p.type, ok: true };
    });
    frame(ctx, v3(5.5, 3.2, 3), v3(0, 0.8, 0), 2);
    hud();
  };

  const finish = () => {
    phase = 'done';
    const score = results.filter((r) => r.ok).reduce((a, r) => a + r.type.value, 0);
    const max = load.reduce((a, t) => a + t.value, 0);
    const b = best('ute', ctx.seed, score);
    ui.end(
      {
        title: results.every((r) => r.ok) ? 'Everything made it!' : 'Made it to the bach',
        score: `${score} pts`,
        grid: [...results.map((r) => ({ label: r.type.name, tone: (r.ok ? 'good' : 'bad') as 'good' | 'bad' })), ...load.filter((t) => !placed.some((p) => p.type === t)).map((t) => ({ label: t.name, tone: 'neutral' as const }))],
        shareGrid: results.map((r) => (r.ok ? '📦' : '💥')).join(''),
        note: [...results.filter((r) => !r.ok).map((r) => `${r.type.name} ${r.why}.`), b > score ? `Best today: ${b}.` : `Today's load is worth up to ${max}, but it won't all fit.`].join(' '),
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  /** Packs the most valuable things first, keeping the fragile ones out of the back row. */
  const autoPack = async () => {
    const order = [...load].sort((a, b) => b.value / (b.w * b.d) - a.value / (a.w * a.d));
    for (const t of order) {
      let done = false;
      for (const rot of [false, true]) {
        const w = rot ? t.d : t.w;
        const d = rot ? t.w : t.d;
        for (let r = 0; r <= ROWS - d && !done; r++) {
          if ((t.fragile || !t.heavy) && r + d - 1 === ROWS - 1) continue;
          for (let c = 0; c <= COLS - w && !done; c++) {
            if (fits(w, d, c, r)) {
              await place(t, c, r, w, d);
              done = true;
            }
          }
        }
        if (done) break;
      }
    }
  };

  const reset = () => {
    for (const p of placed) tray.remove(p.object);
    placed = [];
    selected = null;
    rotated = false;
    ute.position.set(0, 0, 0);
    ute.rotation.set(0, 0, 0);
  };

  const zone: GameZone = {
    start() {
      reset();
      const rng = mulberry32(hashString(`ute:${ctx.seed}`));
      load = shuffle(ITEMS, rng).slice(0, 9);
      phase = 'pack';
      ctx.player.place(v3(2.6, 0, -1.6), -Math.PI / 2);
      const dist = fitDistance(ctx, 3.2, 4.4);
      frame(ctx, v3(0, dist * 0.95 + TRAY_Y, dist * 0.32 + 0.9), v3(0, TRAY_Y, 0.75));
      bound = pointer(ctx, { planeY: TRAY_Y, tap: (p) => void tapTray(p.ground) });
      ui.hint('Tap an item, then tap the tray. Fragile things break in the back row (orange).');
      sheet();
      showFootprint();
    },
    stop() {
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
      cellMeshes.forEach((m) => (m.visible = false));
    },
    update(dt, elapsed) {
      dust.update(dt);
      if (phase !== 'drive') return;
      driveT += dt;
      // Bump along the gravel: the ute rocks, loose things lift and some fly out of the back.
      ute.position.y = Math.abs(Math.sin(elapsed * 11)) * 0.08;
      ute.rotation.x = Math.sin(elapsed * 7) * 0.04;
      ute.rotation.z = Math.sin(elapsed * 5.3) * 0.03;
      if (Math.random() < dt * 6) dust.fire(root.worldToLocal(ute.localToWorld(v3(0, 0.1, 2.4))), 0.4);
      results.forEach((r, i) => {
        const p = placed[i];
        if (!r.ok && driveT > 1.2 + i * 0.25) {
          p.object.position.y += dt * 2.2;
          p.object.position.z += dt * 3.5;
          p.object.rotation.x += dt * 5;
        }
      });
      if (driveT > 4.5) finish();
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, placed: placed.map((p) => p.type.id), used: used() }),
      autoplay: async () => {
        await autoPack();
        drive();
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
      },
    },
  };
  return zone;
}

/** A Kiwi farm ute: cab at -Z, flat tray at +Z with drop sides. About 4.6 m long. */
function buildUte(): THREE.Group {
  const g = new THREE.Group();
  const body = '#c8d3dd';
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.5, 4.6), '#3b3f46', 0, 0.55, 0));
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.65, 1.6), body, 0, 1.12, -1.4));
  g.add(mesh(new THREE.BoxGeometry(1.7, 0.6, 1.2), body, 0, 1.72, -1.3));
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.48, 0.05), '#7fb6d6', 0, 1.74, -0.68));
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.42, 0.05), '#7fb6d6', 0, 1.72, -1.92));
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.4, 0.6), body, 0, 1.0, -2.25));
  g.add(mesh(new THREE.BoxGeometry(1.95, 0.1, 2.85), '#9aa0a8', 0, 0.86, 0.85));
  for (const x of [-0.95, 0.95]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.32, 2.85), '#9aa0a8', x, 1.07, 0.85));
  g.add(mesh(new THREE.BoxGeometry(1.95, 0.32, 0.06), '#9aa0a8', 0, 1.07, -0.57));
  g.add(mesh(new THREE.BoxGeometry(1.95, 0.32, 0.06), '#9aa0a8', 0, 1.07, 2.27));
  for (const [x, z] of [[-0.9, -1.5], [0.9, -1.5], [-0.9, 1.5], [0.9, 1.5]]) {
    const w = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16), '#1f2228', x, 0.38, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), '#ffe9a3', -0.6, 1.0, -2.56), mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), '#ffe9a3', 0.6, 1.0, -2.56));
  return g;
}
