import * as THREE from 'three';
import { spawnProp } from '../../shared/assets';
import { best, burst, controls, disposeTree, frame, markCursor, mesh, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Pav Lab, a bake-off tent on the green. Make a pavlova where every choice is real food
 * chemistry: whisk the egg whites to stiff peaks (not past them), add the sugar a spoon at a
 * time so it dissolves, bake low and slow, cool in the oven. Then scale the recipe for a
 * bigger crowd. The pav you get shows exactly what went right or wrong.
 */
const SPOONS = 8;

type Step = 'whisk' | 'sugar' | 'bake' | 'result' | 'scale' | 'done';
type Phase = 'idle' | 'play' | 'done';

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;

  // -- The tent and bench ---------------------------------------------------------------
  const tent = new THREE.Group();
  for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) tent.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), '#e9e4d8', x, 1.3, z));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.1, 4, 1, true), new THREE.MeshLambertMaterial({ color: '#f4f0e6', side: THREE.DoubleSide }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 3.15;
  roof.castShadow = true;
  tent.add(roof);
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.ConeGeometry(3.32, 1.1, 4, 1, true, i * (Math.PI / 2), Math.PI / 8), new THREE.MeshLambertMaterial({ color: '#d7263d', side: THREE.DoubleSide }));
    stripe.rotation.y = Math.PI / 4;
    stripe.position.y = 3.15;
    tent.add(stripe);
  }
  root.add(tent);
  root.add(mesh(new THREE.BoxGeometry(3.4, 0.9, 0.9), '#f4f0e6', 0, 0.45, -0.9));
  root.add(mesh(new THREE.BoxGeometry(3.5, 0.06, 1), '#c9995a', 0, 0.93, -0.9));
  const oven = await spawnProp('restaurant/oven', { height: 1 });
  oven.object.position.set(1.4, 0, -0.9);
  root.add(oven.object);
  const bowl = await spawnProp('restaurant/bowl', { width: 0.5 });
  bowl.object.position.set(-0.6, 0.96, -0.9);
  root.add(bowl.object);
  const foam = mesh(new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#fbfbf6', -0.6, 1.02, -0.9);
  foam.scale.set(1, 0.05, 1);
  root.add(foam);
  const plate = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24), '#fbfbf6', 0.2, 0.97, -0.9);
  root.add(plate);
  const pav = new THREE.Group();
  pav.position.set(0.2, 0.98, -0.9);
  root.add(pav);
  for (const [x, c] of [[-1.4, '#f2c03a'], [-1.15, '#fbfbf6'], [-0.95, '#fbfbf6']] as [number, string][]) root.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), c, x, 1.0, -1.1));
  const sparkle = burst(60);
  root.add(sparkle.object);

  // -- State ---------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let step: Step = 'whisk';
  let volume = 0; // 0..1.5: 1.0 = stiff peaks, past 1.25 = over-whipped
  let whisking = false;
  let spoons = 0;
  let undissolved = 0;
  let sinceSpoon = 0;
  let temp = 150;
  let minutes = 60;
  let coolInOven = false;
  let result: { score: number; notes: string[]; height: number; cracks: number; brown: number; weep: number } | null = null;
  let scaleRight = false;
  let auto = false;

  const sheetEl = document.createElement('div');
  const hud = () => {
    const labels: Record<Step, string> = { whisk: 'Step 1 · whisk', sugar: 'Step 2 · sugar', bake: 'Step 3 · bake', result: 'Out of the oven', scale: 'Bonus · scale it up', done: '' };
    ui.subtitle(labels[step]);
    ui.stats([{ label: 'Score', value: result ? String(result.score) : '…' }]);
  };
  const stage = () => (volume < 0.35 ? 'Frothy' : volume < 0.8 ? 'Soft peaks' : volume <= 1.2 ? 'Stiff, glossy peaks' : 'Over-whipped: going grainy');

  const render = () => {
    hud();
    if (step === 'whisk') {
      sheetEl.innerHTML = `
        <div class="puzzle">Whisk the egg whites until they hold <b>stiff peaks</b>. Whisking traps air in a net of egg proteins. Go too far and the net breaks.</div>
        <div class="readout"><div>Foam<b data-stage>${stage()}</b></div><div>Volume<b data-vol>${Math.round(volume * 100)}%</b></div></div>
        <div class="tool-row two"><button class="btn" data-hold>Hold to whisk</button><button class="btn btn-primary" data-done>Peaks look good</button></div>`;
      const hold = sheetEl.querySelector<HTMLButtonElement>('[data-hold]')!;
      hold.addEventListener('pointerdown', () => (whisking = true));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => (whisking = false));
      sheetEl.querySelector('[data-done]')!.addEventListener('click', () => toSugar());
    } else if (step === 'sugar') {
      sheetEl.innerHTML = `
        <div class="puzzle">Add the caster sugar <b>one spoon at a time</b>, whisking between spoons so each one dissolves. Undissolved sugar weeps out as syrup later.</div>
        <div class="readout"><div>Sugar<b data-sp>${spoons} / ${SPOONS} spoons</b></div><div>Gritty sugar<b data-und>${undissolved ? `${undissolved} spoon${undissolved > 1 ? 's' : ''}` : 'None'}</b></div></div>
        <div class="tool-row two"><button class="btn" data-hold>Hold to whisk</button><button class="btn btn-primary" data-spoon>Add a spoon</button></div>`;
      const hold = sheetEl.querySelector<HTMLButtonElement>('[data-hold]')!;
      hold.addEventListener('pointerdown', () => (whisking = true));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => (whisking = false));
      sheetEl.querySelector('[data-spoon]')!.addEventListener('click', () => addSpoon());
    } else if (step === 'bake') {
      sheetEl.innerHTML = `
        <div class="puzzle">Bake to dry the meringue without browning it. Then decide: open the door, or let it cool slowly in the oven?</div>
        <div class="slider"><label for="pav-t">Oven <span>${temp}°C</span></label><input id="pav-t" type="range" min="90" max="200" step="10" value="${temp}"></div>
        <div class="slider"><label for="pav-m">Time <span>${minutes} min</span></label><input id="pav-m" type="range" min="30" max="150" step="10" value="${minutes}"></div>
        <label class="pick" style="display:flex;align-items:center;gap:10px;margin:0 4px 10px"><input type="checkbox" data-cool ${coolInOven ? 'checked' : ''}> <b>Cool in the oven, door shut</b></label>
        <button class="btn btn-primary btn-wide" data-bake>Bake</button>`;
      sheetEl.querySelector<HTMLInputElement>('#pav-t')!.addEventListener('input', (e) => {
        temp = Number((e.target as HTMLInputElement).value);
        (e.target as HTMLInputElement).previousElementSibling!.querySelector('span')!.textContent = `${temp}°C`;
      });
      sheetEl.querySelector<HTMLInputElement>('#pav-m')!.addEventListener('input', (e) => {
        minutes = Number((e.target as HTMLInputElement).value);
        (e.target as HTMLInputElement).previousElementSibling!.querySelector('span')!.textContent = `${minutes} min`;
      });
      sheetEl.querySelector<HTMLInputElement>('[data-cool]')!.addEventListener('change', (e) => (coolInOven = (e.target as HTMLInputElement).checked));
      sheetEl.querySelector('[data-bake]')!.addEventListener('click', () => bake());
    } else if (step === 'result' && result) {
      sheetEl.innerHTML = `
        <div class="sheet-title">${result.score >= 85 ? 'A Nana-grade pav!' : result.score >= 60 ? 'A respectable pav' : 'It’s… a pav'}</div>
        <div class="sheet-body">${result.notes.join(' ')}</div>
        <button class="btn btn-primary btn-wide" data-next>Scale it up</button>`;
      sheetEl.querySelector('[data-next]')!.addEventListener('click', () => {
        step = 'scale';
        render();
      });
    } else if (step === 'scale') {
      sheetEl.innerHTML = `
        <div class="puzzle">This recipe uses <b>4 egg whites</b> and feeds <b>8</b>. The whole whānau is coming: <b>20 people</b>. How many egg whites?</div>
        <div class="tool-row three">${ANSWERS.map((n) => `<button class="btn" data-n="${n}">${n}</button>`).join('')}</div>`;
      sheetEl.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.n))));
    }
    ui.sheet(sheetEl);
    if (step === 'scale') markCursor(sheetEl.querySelectorAll('[data-n]'), answerCursor);
    if (step !== lastHintStep) {
      lastHintStep = step;
      ui.hint(HINTS[step] ?? null);
    }
  };

  // -- Keyboard/gamepad ---------------------------------------------------------------
  const HINTS: Partial<Record<Step, string>> = {
    whisk: controls({ touch: 'Hold to whisk until it holds stiff peaks.', keyboard: 'Hold {Space} to whisk, {Enter} when the peaks look good.', pad: 'Hold {A} to whisk, {X} when the peaks look good.' }),
    sugar: controls({ touch: 'Add a spoon, whisk, add the next.', keyboard: 'Hold {Space} to whisk, {Enter} adds a spoon of sugar.', pad: 'Hold {A} to whisk, {X} adds a spoon of sugar.' }),
    bake: controls({ touch: 'Set the oven and the time, then bake.', keyboard: 'Oven {←} {→}, time {↑} {↓}, {C} cool in the oven, {Space} to bake.', pad: 'Oven left/right, time up/down, {Y} cool in the oven, {A} to bake.' }),
    result: controls({ touch: 'Read what happened, then scale it up.', keyboard: '{Space} to scale it up.', pad: '{A} to scale it up.' }),
    scale: controls({ touch: 'Pick the number of egg whites.', keyboard: 'Pick with {←} {→}, {Space} to answer.', pad: 'Pick with the left stick, {A} to answer.' }),
  };
  const ANSWERS = [6, 8, 10, 12];
  let answerCursor = 0;
  let lastHintStep: Step | null = null;
  let padWhisk = false;
  const padInput = () => {
    const input = ctx.input;
    const action = input.pressed('west') || input.keyPressed('Enter');
    if (step === 'whisk' || step === 'sugar') {
      // Only follow the button when it changes, so a finger holding the on-screen button still works.
      const held = input.confirmHeld();
      if (held !== padWhisk) whisking = padWhisk = held;
      if (action) step === 'whisk' ? toSugar() : addSpoon();
    } else if (step === 'bake') {
      const nav = input.nav();
      if (nav.x || nav.y) {
        temp = THREE.MathUtils.clamp(temp + nav.x * 10, 90, 200);
        minutes = THREE.MathUtils.clamp(minutes + nav.y * 10, 30, 150);
        render();
      }
      if (input.pressed('north') || input.keyPressed('KeyC')) {
        coolInOven = !coolInOven;
        render();
      }
      if (input.confirm() || action) bake();
    } else if (step === 'result') {
      if (input.confirm() || action) {
        step = 'scale';
        render();
      }
    } else if (step === 'scale') {
      const x = input.nav().x;
      if (x) {
        answerCursor = THREE.MathUtils.clamp(answerCursor + x, 0, ANSWERS.length - 1);
        markCursor(sheetEl.querySelectorAll('[data-n]'), answerCursor);
      }
      if (input.confirm() || action) answer(ANSWERS[answerCursor]);
    }
  };

  const toSugar = () => {
    if (volume < 0.8) return ui.toast('Not yet: keep whisking until it holds a peak', 'info');
    step = 'sugar';
    render();
  };
  const addSpoon = () => {
    if (spoons >= SPOONS) return;
    if (sinceSpoon < 0.8 && spoons > 0) undissolved++;
    spoons++;
    sinceSpoon = 0;
    if (spoons >= SPOONS) {
      window.setTimeout(() => {
        step = 'bake';
        render();
      }, 600);
    }
    render();
  };

  const bake = () => {
    const notes: string[] = [];
    let score = 100;
    let height = 1;
    let cracks = 0;
    let brown = 0;
    let weep = 0;
    if (volume > 1.25) {
      score -= 25;
      height = 0.55;
      notes.push('Over-whipped whites lost their structure, so it slumped.');
    } else if (volume < 0.95) {
      score -= 15;
      height = 0.75;
      notes.push('Softer peaks meant less air held, so it spread.');
    } else notes.push('Stiff, glossy peaks gave it a tall crown.');
    if (undissolved) {
      score -= undissolved * 6;
      weep = undissolved;
      notes.push(`${undissolved} spoon${undissolved > 1 ? 's' : ''} of sugar didn’t dissolve and wept out as sticky beads.`);
    } else notes.push('Every spoon of sugar dissolved: no weeping.');
    if (temp > 150) {
      score -= Math.min(30, (temp - 150) * 0.6);
      brown = Math.min(1, (temp - 150) / 50);
      cracks += 2;
      notes.push('Too hot: the outside browned and the air inside expanded too fast and cracked it.');
    } else if (temp < 110) {
      score -= 12;
      notes.push('Very low heat: it never quite set.');
    }
    const dryness = ((temp - 90) / 60) * (minutes / 75);
    if (dryness < 0.55) {
      score -= 15;
      height *= 0.8;
      notes.push('Not baked long enough to dry out: it sank in the middle.');
    } else if (dryness > 1.8) {
      score -= 12;
      brown = Math.max(brown, 0.4);
      notes.push('Baked so long it went chalky all the way through. A pav wants a marshmallow middle.');
    } else notes.push('Crisp shell, soft marshmallow middle.');
    if (!coolInOven) {
      score -= 12;
      cracks += 2;
      notes.push('Cold air hit it fast when the door opened, so the shell cracked.');
    } else notes.push('Cooling slowly in the oven stopped it cracking.');
    result = { score: Math.max(5, Math.round(score)), notes, height, cracks, brown, weep };
    buildPav(pav, result);
    foam.visible = false;
    step = 'result';
    if (result.score >= 85) {
      sparkle.fire(root.worldToLocal(pav.getWorldPosition(v3())).add(v3(0, 0.3, 0)), 0.6);
      ctx.player.character.play('Cheering');
    }
    render();
  };

  const answer = (n: number) => {
    scaleRight = n === 10;
    ui.toast(scaleRight ? 'Yes: 20 is 2.5 × 8, and 2.5 × 4 = 10' : 'Not quite: 20 people is 2.5 × the recipe, so 2.5 × 4 = 10 whites', scaleRight ? 'good' : 'bad', 2600);
    finish();
  };

  const finish = () => {
    phase = 'done';
    step = 'done';
    ui.sheet(null);
    const total = (result?.score ?? 0) + (scaleRight ? 10 : 0);
    const b = best('pavlab', 'all', total);
    ui.end(
      {
        title: total >= 95 ? 'Nana would be proud' : total >= 70 ? 'Bring a plate: sorted' : 'Back to the whisk',
        score: `${total} / 110`,
        grid: [
          { label: volume >= 0.95 && volume <= 1.25 ? 'Stiff peaks' : 'Peaks off', tone: volume >= 0.95 && volume <= 1.25 ? 'good' : 'bad' },
          { label: undissolved ? 'Wept' : 'No weeping', tone: undissolved ? 'bad' : 'good' },
          { label: temp <= 150 && temp >= 110 ? 'Low and slow' : 'Wrong heat', tone: temp <= 150 && temp >= 110 ? 'good' : 'bad' },
          { label: coolInOven ? 'Cooled slowly' : 'Cracked', tone: coolInOven ? 'good' : 'bad' },
          { label: scaleRight ? '10 whites' : 'Scaling off', tone: scaleRight ? 'great' : 'bad' },
        ],
        shareGrid: `🥚${scaleRight ? '✅' : '❌'}`,
        note: b > total ? `Your best: ${b}` : '',
      },
      'bake-off',
    );
  };

  const reset = () => {
    step = 'whisk';
    volume = 0;
    spoons = 0;
    undissolved = 0;
    sinceSpoon = 99;
    temp = 160;
    minutes = 50;
    coolInOven = false;
    result = null;
    scaleRight = false;
    pav.clear();
    foam.visible = true;
    foam.scale.set(1, 0.05, 1);
  };

  const zone: GameZone = {
    start() {
      reset();
      phase = 'play';
      lastHintStep = null;
      answerCursor = 0;
      padWhisk = false;
      ctx.player.place(v3(-2.6, 0, -0.2), Math.PI / 2);
      // Stand just outside the tent, under the eaves, looking down at the bench.
      frame(ctx, v3(0, 2.25, 2.7), v3(0, 0.9, -0.95));
      render();
    },
    stop() {
      auto = false;
      whisking = false;
      phase = 'idle';
      ui.sheet(null);
    },
    update(dt, elapsed) {
      sparkle.update(dt);
      if (phase === 'play' && !auto) padInput();
      sinceSpoon += whisking ? dt : 0;
      if (phase !== 'play') return;
      if (whisking && (step === 'whisk' || step === 'sugar')) {
        // Sugar stabilises the foam: whisking it in barely changes the volume.
        volume += dt * (step === 'whisk' ? 0.28 : 0.012);
        ctx.player.character.play('Use_Item');
        bowl.object.rotation.y = Math.sin(elapsed * 20) * 0.06;
      }
      foam.scale.set(1, 0.05 + Math.min(volume, 1.2) * 0.55, 1);
      (foam.material as THREE.MeshLambertMaterial).color.set(volume > 1.25 ? '#e9e2d0' : '#fbfbf6');
      const st = sheetEl.querySelector('[data-stage]');
      if (st) {
        st.textContent = stage();
        sheetEl.querySelector('[data-vol]')!.textContent = `${Math.round(volume * 100)}%`;
      }
      if (auto) {
        if (step === 'whisk') {
          whisking = volume < 1.05;
          if (!whisking) toSugar();
        } else if (step === 'sugar') {
          whisking = true;
          if (sinceSpoon > 0.9 && spoons < SPOONS) addSpoon();
        } else if (step === 'bake') {
          whisking = false;
          temp = 130;
          minutes = 80;
          coolInOven = true;
          bake();
        } else if (step === 'result') {
          step = 'scale';
          render();
        } else if (step === 'scale') answer(10);
      }
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, step, volume: +volume.toFixed(2), spoons, undissolved, temp, minutes, coolInOven, score: result?.score }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  return zone;
}

/** The finished pav shows what happened: height, cracks, browning, beads of syrup, toppings. */
function buildPav(g: THREE.Group, r: { height: number; cracks: number; brown: number; weep: number }): void {
  g.clear();
  const shell = new THREE.Color('#fbf6ea').lerp(new THREE.Color('#d9a35b'), r.brown);
  const h = 0.18 * r.height;
  const body = mesh(new THREE.CylinderGeometry(0.26, 0.29, h, 24), `#${shell.getHexString()}`, 0, h / 2, 0);
  g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.04, 24), '#fffdf6', 0, h + 0.02, 0));
  for (let i = 0; i < r.cracks; i++) {
    const crack = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.012), '#b98a5a', 0, h + 0.042, 0);
    crack.rotation.y = i * 1.3;
    g.add(crack);
  }
  for (let i = 0; i < r.weep * 3; i++) g.add(mesh(new THREE.SphereGeometry(0.018, 6, 5), '#e8b04a', Math.cos(i * 2.1) * 0.28, 0.02, Math.sin(i * 2.1) * 0.28));
  // Kiwifruit and strawberries on the cream.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 10), i % 2 ? '#7cb342' : '#d7263d', Math.cos(a) * 0.13, h + 0.05, Math.sin(a) * 0.13));
  }
}
