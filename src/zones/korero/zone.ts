import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { hashString, mulberry32, shuffle } from '../../shared/rng';
import { best, burst, disposeTree, fitDistance, frame, helper, mesh, pointer, toScreen, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Kōrero Kirihimete: help set the Christmas table at the yellow bach. A whānau member asks
 * for things in te reo Māori ("Homai te kapu whero, koa": pass the red cup, please) and you
 * hand over the right one. Wrong items get a laugh, not a red cross. Words do things here;
 * there's no test.
 *
 * GATED: hidden from the public world (only shown with ?preview). Every phrase must be checked
 * by a fluent te reo Māori speaker, and recorded audio by a native speaker added, before launch.
 */
interface Thing { id: string; reo: string; english: string; colour?: { reo: string; english: string; hex: string }; build: () => Promise<THREE.Object3D> }

const C = {
  whero: { reo: 'whero', english: 'red', hex: '#d7263d' },
  kahurangi: { reo: 'kahurangi', english: 'blue', hex: '#2f6fd6' },
  kakariki: { reo: 'kākāriki', english: 'green', hex: '#3e8e4e' },
  kowhai: { reo: 'kōwhai', english: 'yellow', hex: '#ffd23f' },
};

const cup = (c: typeof C.whero) => async () => new THREE.Group().add(mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.14, 12), c.hex, 0, 0.07, 0));
const plate = (c: typeof C.whero) => async () => new THREE.Group().add(mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.02, 18), c.hex, 0, 0.01, 0));
const THINGS: Thing[] = [
  { id: 'kapu-whero', reo: 'te kapu', english: 'the cup', colour: C.whero, build: cup(C.whero) },
  { id: 'kapu-kahurangi', reo: 'te kapu', english: 'the cup', colour: C.kahurangi, build: cup(C.kahurangi) },
  { id: 'pereti-kakariki', reo: 'te pereti', english: 'the plate', colour: C.kakariki, build: plate(C.kakariki) },
  { id: 'pereti-kowhai', reo: 'te pereti', english: 'the plate', colour: C.kowhai, build: plate(C.kowhai) },
  { id: 'aporo', reo: 'te āporo', english: 'the apple', build: async () => new THREE.Group().add(mesh(new THREE.SphereGeometry(0.07, 12, 10), '#c0392b', 0, 0.07, 0), mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 4), '#5b4229', 0, 0.15, 0)) },
  { id: 'keke', reo: 'te keke', english: 'the cake', build: async () => new THREE.Group().add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 16), '#e8c48a', 0, 0.06, 0), mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), '#fbfbf6', 0, 0.13, 0)) },
  { id: 'miraka', reo: 'te miraka', english: 'the milk', build: async () => new THREE.Group().add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), '#fbfbf6', 0, 0.1, 0), mesh(new THREE.BoxGeometry(0.081, 0.06, 0.081), '#2f6fd6', 0, 0.16, 0)) },
  { id: 'maripi', reo: 'te māripi', english: 'the knife', build: async () => new THREE.Group().add(mesh(new THREE.BoxGeometry(0.03, 0.01, 0.22), '#c9ced6', 0, 0.01, 0)) },
  { id: 'paoka', reo: 'te paoka', english: 'the fork', build: async () => new THREE.Group().add(mesh(new THREE.BoxGeometry(0.03, 0.01, 0.2), '#9aa0a8', 0, 0.01, 0)) },
];

const ROUNDS = 8;
type Phase = 'idle' | 'play' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const table = await spawnProp('furniture/table_medium_long', { width: 2.6 });
  table.object.position.set(0, 0, -0.6);
  root.add(table.object);
  const top = table.size.y;
  const asker = await helper(ctx, 1);
  asker.root.position.set(0, 0, -1.7);
  asker.play('Idle_B');
  const yay = burst(50);
  root.add(yay.object);
  const items = await Promise.all(
    THINGS.map(async (t, i) => {
      const o = await t.build();
      const spot = v3(-1.05 + (i % 5) * 0.52, top, -0.85 + Math.floor(i / 5) * 0.5);
      o.position.copy(spot);
      root.add(o);
      return { t, o, spot };
    }),
  );

  let phase: Phase = 'idle';
  let order: Thing[] = [];
  let round = 0;
  let firstTry = 0;
  let missed = false;
  let showEnglish = false;
  let auto = false;
  let bound: ReturnType<typeof pointer> | null = null;

  const phrase = (t: Thing) => `Homai ${t.reo}${t.colour ? ` ${t.colour.reo}` : ''}, koa.`;
  const english = (t: Thing) => `Pass ${t.english}${t.colour ? ` (${t.colour.english})` : ''}, please.`;

  const sheetEl = document.createElement('div');
  const render = () => {
    const t = order[round];
    ui.subtitle(`Request ${round + 1} of ${ROUNDS}`);
    ui.stats([{ label: 'First try', value: String(firstTry) }]);
    sheetEl.innerHTML = `
      <div class="say">${phrase(t)}${showEnglish ? `<small>${english(t)}</small>` : ''}</div>
      <p class="review-note">Preview only: phrases are awaiting review by a fluent te reo Māori speaker, and audio is still to be recorded.</p>
      <div class="tool-row two"><button class="btn" data-en>${showEnglish ? 'Hide' : 'Show'} English</button><button class="btn btn-ghost" data-again>Hear it again</button></div>`;
    sheetEl.querySelector('[data-en]')!.addEventListener('click', () => {
      showEnglish = !showEnglish;
      render();
    });
    sheetEl.querySelector('[data-again]')!.addEventListener('click', () => ui.toast('Audio coming once recorded by a native speaker', 'info'));
    ui.sheet(sheetEl);
  };

  const pick = (id: string) => {
    if (phase !== 'play') return;
    const want = order[round];
    if (id !== want.id) {
      missed = true;
      asker.play('Hit_A', { then: () => asker.play('Idle_B') });
      const got = THINGS.find((t) => t.id === id)!;
      ui.toast(`That’s ${got.reo}${got.colour ? ` ${got.colour.reo}` : ''}! Kāo, not that one.`, 'info', 2000);
      return;
    }
    if (!missed) firstTry++;
    asker.play('Cheering', { then: () => asker.play('Idle_B') });
    yay.fire(items.find((x) => x.t.id === id)!.spot.clone().setY(top + 0.2), 0.4);
    ui.toast('Ka pai! Ngā mihi.', 'good');
    round++;
    missed = false;
    if (round >= ROUNDS) return finish();
    render();
  };

  const finish = () => {
    phase = 'done';
    ui.sheet(null);
    const b = best('korero', 'all', firstTry);
    ui.end(
      {
        title: 'Ka rawe! The table is set',
        score: `${firstTry}/${ROUNDS} first try`,
        grid: order.map((t) => ({ label: `${t.reo.replace('te ', '')}${t.colour ? ` ${t.colour.reo}` : ''}`, tone: 'good' })),
        shareGrid: '🍽️',
        note: `Preview build: phrases awaiting review.${b > firstTry ? ` Best: ${b}.` : ''}`,
      },
      'preview',
    );
  };

  const zone: GameZone = {
    start() {
      const rng = mulberry32(hashString(`korero:${ctx.seed}`));
      order = shuffle(THINGS, rng).slice(0, ROUNDS);
      round = 0;
      firstTry = 0;
      missed = false;
      phase = 'play';
      ctx.player.place(v3(0, 0, 0.6), Math.PI);
      const d = fitDistance(ctx, 3, 2.2);
      frame(ctx, v3(0, top + d * 0.75, -0.6 + d * 0.65), v3(0, top, -0.7));
      bound = pointer(ctx, {
        planeY: top,
        tap: (p) => {
          if (!p.ground) return;
          const hit = items.map((x) => ({ x, d: x.spot.distanceTo(v3(p.ground!.x, top, p.ground!.z)) })).sort((a, b) => a.d - b.d)[0];
          if (hit && hit.d < 0.3) pick(hit.x.t.id);
        },
      });
      ui.hint('Tap what they ask for on the table. Tap “Show English” if you get stuck.');
      render();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
    },
    update(dt) {
      yay.update(dt);
      if (auto && phase === 'play') pick(order[round].id);
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, round, firstTry }),
      item: (id: string) => toScreen(ctx, items.find((x) => x.t.id === id)!.spot),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 300));
        auto = false;
      },
    },
  };
  return zone;
}
