import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, float, fract, mix, positionGeometry, positionWorld, sin, smoothstep, step, texture, uniform } from 'three/tsl';
import { world } from '../../engine/tsl';
import { buildWorldData } from '../../world/dataTexture';
import { worldUv } from '../../world/ground';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import { SEA_LEVEL, waterline } from '../../world/terrain';
import { best, disposeTree, frame, helper, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Between the Flags, from the patrol tower. Each round the surf is different and hides one or
 * two rips: the darker, calmer-looking gaps where the waves don't break. Drag the red-and-yellow
 * flags to the safest stretch, then open the beach. Swimmers inside a rip get pulled out and
 * need rescuing. Learning comes from reading the water, not from a quiz.
 *
 * Safety messages follow Surf Life Saving NZ's 3Rs (Relax and float, Raise your hand, Ride the
 * rip). This content must be reviewed by SLSNZ or Water Safety NZ before launch.
 */
const ROUNDS = 4;
const SWIMMERS = 10;
const FLAG_GAP = 10;
const HALF_BEACH = 22;

type Phase = 'idle' | 'place' | 'swim' | 'review' | 'done';
interface Rip { x: number; w: number }
interface Swimmer { mesh: THREE.Group; x: number; z: number; caught: boolean; delay: number }

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  // Zone faces the sea (local -Z is seaward). Work out where the water starts in local space.
  root.updateMatrixWorld(true);
  const worldAnchor = root.position.clone();
  const shoreZ = -(waterline(worldAnchor.x) - worldAnchor.z);
  // Sit just above the world's own sea (which bobs about 0.1 m) so the surf reads clearly.
  const seaY = SEA_LEVEL - worldAnchor.y + 0.2;

  // -- Surf: our own patch of sea showing sandbars, breaking waves and rips -------------------
  // TSL: compiles to WGSL on WebGPU and GLSL on the WebGL fallback.
  const uniforms = { uTime: uniform(0), uRips: uniform(new THREE.Vector4(0, 0, 0, 0)), uShow: uniform(0) };
  const surfMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  {
    const x = positionGeometry.x;
    const dist = positionGeometry.y.add(17); // 0 at the shore, 34 m out to sea
    const rip = (c: typeof x, w: typeof x) => float(1).sub(smoothstep(w.mul(0.35), w.mul(0.6), x.sub(c).abs())).mul(step(float(0.001), w));
    const R = uniforms.uRips;
    const r = rip(R.x, R.y).max(rip(R.z, R.w));
    const t = uniforms.uTime;
    // Rows of breaking waves over the sandbar. A rip breaks the rows: no foam, darker, flat-looking.
    const wave = fract(dist.mul(0.14).add(t.mul(0.22)).add(sin(x.mul(0.15)).mul(0.15)));
    // Depth from the same world data texture as the sea, so the patch follows the real, curved
    // waterline and uses the sea's own colours: it reads as part of the bay, not a panel on it.
    const depth = texture(buildWorldData().data, worldUv(positionWorld.x, positionWorld.z)).b.mul(4);
    const foam = smoothstep(float(0.86), float(0.98), wave).mul(smoothstep(float(0.35), float(0.9), depth)).mul(float(1).sub(smoothstep(float(26), float(33), dist)))
      .mul(float(1).sub(r.mul(0.92)));
    let col = mix(color('#48d4c8'), color('#0d6a98'), smoothstep(float(0.2), float(3.6), depth));
    col = mix(col, color('#12576b'), r.mul(smoothstep(float(0.3), float(1.2), depth)));
    // A rip carries sand and foam scraps out to sea: faint streaks moving offshore.
    const streak = smoothstep(float(0.92), float(1), fract(dist.mul(0.35).sub(t.mul(0.6)).add(x.mul(0.4)))).mul(r).mul(0.25);
    col = mix(col, color('#9ea88c'), streak);
    col = mix(col, color('#ffffff'), foam.clamp(0, 1).mul(0.85));
    // After the round, outline the rips so players learn the look.
    col = mix(col, color('#ff5940'), uniforms.uShow.mul(r).mul(sin(t.mul(6)).mul(0.25).add(0.35)));
    // Unlit: follow the day/night light like the rest of the water.
    surfMat.colorNode = col.mul(world.light);
    // Nothing on dry sand, and soft on every side so no edge of the patch ever shows.
    const sides = float(1).sub(smoothstep(float(HALF_BEACH - 4), float(HALF_BEACH + 10), x.abs()));
    const far = float(1).sub(smoothstep(float(22), float(33), dist));
    surfMat.opacityNode = smoothstep(float(0.02), float(0.3), depth).mul(sides).mul(far).mul(0.95);
  }
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(HALF_BEACH * 2 + 20, 34, 1, 1), surfMat);
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(0, seaY, shoreZ - 17 + 0.6);
  surf.renderOrder = 3;
  root.add(surf);

  // -- Flags, lifeguard, patrol gear ----------------------------------------------------
  const flag = () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), '#e9e4d8', 0, 1.4, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.5, 0.85), '#d7263d', 0, 2.5, 0.43), mesh(new THREE.BoxGeometry(0.03, 0.5, 0.85), '#ffd23f', 0, 2.0, 0.43));
    return g;
  };
  const flags = [flag(), flag()];
  flags.forEach((f) => root.add(f));
  const guard = await helper(ctx, 0);
  guard.play('Idle_B');
  const arrows = new THREE.Group();
  root.add(arrows);

  // -- State --------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let round = 0;
  let rips: Rip[] = [];
  let centre = 0;
  let swimmers: Swimmer[] = [];
  let safeTotal = 0;
  let log: number[] = [];
  let t = 0;
  let auto = false;
  let rng = mulberry32(hashString(`flags:${ctx.seed}`));
  let bound: ReturnType<typeof pointer> | null = null;

  const setFlags = (x: number) => {
    centre = THREE.MathUtils.clamp(x, -HALF_BEACH + FLAG_GAP / 2, HALF_BEACH - FLAG_GAP / 2);
    flags[0].position.set(centre - FLAG_GAP / 2, 0, shoreZ + 2.2);
    flags[1].position.set(centre + FLAG_GAP / 2, 0, shoreZ + 2.2);
    guard.root.position.set(centre + 0.8, 0, shoreZ + 3.6);
    guard.root.rotation.y = Math.PI;
  };
  const inRip = (x: number) => rips.some((r) => Math.abs(x - r.x) < r.w * 0.55);
  /** The flag position with the most clear water between the flags (what a lifeguard would pick). */
  const safest = () => {
    let bestX = 0;
    let bestScore = -Infinity;
    for (let x = -HALF_BEACH + FLAG_GAP / 2; x <= HALF_BEACH - FLAG_GAP / 2; x += 0.5) {
      let s = 0;
      for (let k = -FLAG_GAP / 2; k <= FLAG_GAP / 2; k += 0.5) s += inRip(x + k) ? -5 : 1;
      for (const r of rips) s += Math.min(6, Math.abs(x - r.x) - r.w / 2 - FLAG_GAP / 2) * 0.2;
      if (s > bestScore) {
        bestScore = s;
        bestX = x;
      }
    }
    return bestX;
  };

  const hud = () => {
    ui.subtitle(phase === 'place' ? `Beach ${round + 1} of ${ROUNDS} · drag the flags` : phase === 'swim' ? 'Beach open' : `Beach ${round + 1} of ${ROUNDS}`);
    ui.stats([{ label: 'Safe swims', value: String(safeTotal) }]);
  };

  const sheetPlace = document.createElement('div');
  sheetPlace.innerHTML = `<div class="puzzle">Read the water. Waves breaking in white rows = sandbar. A <b>darker, calm-looking gap</b> with no breaking waves = rip. Put the flags where the waves break evenly.</div><button class="btn btn-primary btn-wide" data-open>Open the beach</button>`;
  sheetPlace.querySelector('[data-open]')!.addEventListener('click', () => openBeach());
  const sheetReview = document.createElement('div');
  sheetReview.innerHTML = `<div class="sheet-title"></div><div class="sheet-body"></div><button class="btn btn-primary btn-wide" data-next></button>`;
  sheetReview.querySelector('[data-next]')!.addEventListener('click', () => nextRound());

  const newBeach = () => {
    const n = round === 0 ? 1 : rng() < 0.5 ? 1 : 2;
    rips = [];
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = (rng() - 0.5) * (HALF_BEACH * 2 - 6);
        if (rips.every((r) => Math.abs(r.x - x) > 12)) break;
      }
      rips.push({ x, w: 4 + rng() * 3 });
    }
    uniforms.uRips.value.set(rips[0].x, rips[0].w, rips[1]?.x ?? 0, rips[1]?.w ?? 0);
    uniforms.uShow.value = 0;
    arrows.clear();
    for (const s of swimmers) root.remove(s.mesh);
    swimmers = [];
    setFlags(round === 0 ? rips[0].x : (rng() - 0.5) * 20);
    phase = 'place';
    ui.sheet(sheetPlace);
    hud();
  };

  const openBeach = () => {
    if (phase !== 'place') return;
    phase = 'swim';
    t = 0;
    ui.sheet(null);
    ui.hint(null);
    swimmers = Array.from({ length: SWIMMERS }, (_, i) => {
      const x = centre - FLAG_GAP / 2 + 0.6 + (i / (SWIMMERS - 1)) * (FLAG_GAP - 1.2) + (rng() - 0.5) * 0.6;
      const m = buildSwimmer(['#d7263d', '#27c4f5', '#ffd23f', '#e8578e', '#3e8e4e'][i % 5]);
      m.position.set(x, 0, shoreZ + 1.5);
      root.add(m);
      return { mesh: m, x, z: shoreZ + 1.5, caught: inRip(x), delay: i * 0.25 };
    });
    hud();
  };

  const review = () => {
    phase = 'review';
    uniforms.uShow.value = 1;
    const caught = swimmers.filter((s) => s.caught).length;
    const safe = SWIMMERS - caught;
    safeTotal += safe;
    log.push(safe);
    for (const r of rips) {
      const a = new THREE.ArrowHelper(v3(0, 0, -1), v3(r.x, seaY + 0.4, shoreZ - 3), 9, 0xff5a3c, 1.4, 1);
      arrows.add(a);
    }
    if (caught) {
      guard.play('Waving');
      ctx.player.character.play('Hit_A');
    } else ctx.player.character.play('Cheering');
    sheetReview.querySelector('.sheet-title')!.textContent = caught ? `${caught} swimmer${caught > 1 ? 's' : ''} pulled out by a rip` : 'Everyone swam safely';
    sheetReview.querySelector('.sheet-body')!.innerHTML = caught
      ? 'The red arrows show the rip: a darker, calmer channel with <b>no breaking waves</b> and bits of foam drifting out. It looks like the easiest place to swim. It isn’t.'
      : 'Good read. You kept the flags over the breaking waves on the sandbar and away from the dark, calm-looking gap.';
    (sheetReview.querySelector('[data-next]') as HTMLButtonElement).textContent = round + 1 >= ROUNDS ? 'See how you did' : 'Next beach';
    ui.sheet(sheetReview);
    hud();
  };

  const nextRound = () => {
    round++;
    if (round >= ROUNDS) return finish();
    newBeach();
  };

  const finish = () => {
    phase = 'done';
    ui.sheet(null);
    const total = ROUNDS * SWIMMERS;
    const b = best('flags', ctx.seed, safeTotal);
    ui.end(
      {
        title: safeTotal === total ? 'Every swimmer safe' : safeTotal >= total * 0.75 ? 'Sharp eyes, lifeguard' : 'Rips are sneaky',
        score: `${safeTotal}/${total} safe`,
        grid: log.map((s, i) => ({ label: `Beach ${i + 1}: ${s}/${SWIMMERS}`, tone: s === SWIMMERS ? 'great' : s >= 7 ? 'good' : 'bad' })),
        shareGrid: log.map((s) => (s === SWIMMERS ? '🟢' : s >= 7 ? '🟡' : '🔴')).join(''),
        extra: `<div class="puzzle"><b>Caught in a rip? Remember the 3Rs:</b> Relax and float. Raise your hand. Ride the rip until it lets you go, then swim back to shore. Always swim between the flags.</div>`,
        note: b > safeTotal ? `Best today: ${b}` : 'Safety advice from Surf Life Saving NZ.',
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  const reset = () => {
    round = 0;
    safeTotal = 0;
    log = [];
    rng = mulberry32(hashString(`flags:${ctx.seed}`));
    for (const s of swimmers) root.remove(s.mesh);
    swimmers = [];
    arrows.clear();
  };

  const zone: GameZone = {
    start() {
      reset();
      ctx.player.place(v3(-2.5, 0, shoreZ + 6), Math.PI);
      // From high on the patrol tower, looking out over the surf.
      frame(ctx, v3(0, 21, shoreZ + 13), v3(0, 0, shoreZ - 9));
      bound = pointer(ctx, { planeY: 0, down: (p) => phase === 'place' && p.ground && setFlags(p.ground.x), move: (p) => phase === 'place' && p.ground && setFlags(p.ground.x) });
      ui.hint('Drag anywhere to move the flags along the beach.');
      newBeach();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
      reset();
      uniforms.uRips.value.set(-8, 5, 0, 0);
      setFlags(4);
    },
    update(dt, elapsed) {
      uniforms.uTime.value = elapsed;
      if (auto && phase === 'place') {
        setFlags(safest());
        openBeach();
      }
      if (auto && phase === 'review') nextRound();
      if (phase !== 'swim') return;
      t += dt;
      for (const s of swimmers) {
        const tt = Math.max(0, t - s.delay);
        if (s.caught) {
          // Pulled straight out to sea, faster than anyone can swim back.
          s.z = shoreZ - 2 - Math.min(tt, 6) * 2.4;
          if (tt > 2.4) s.mesh.children[2].visible = true; // raised hand
        } else s.z = shoreZ - Math.min(tt * 1.4, 4 + (s.x % 3));
        s.mesh.position.set(s.x, s.z < shoreZ - 0.5 ? seaY - 0.15 : 0, s.z);
        s.mesh.position.y += Math.sin(elapsed * 3 + s.x) * 0.05;
      }
      if (t > 6.5) review();
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, round, safeTotal, rips: rips.map((r) => +r.x.toFixed(1)), centre }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  uniforms.uRips.value.set(-8, 5, 0, 0);
  setFlags(4);
  return zone;
}

/** A head and shoulders bobbing in the water, with a raised arm (child 2) shown when in trouble. */
function buildSwimmer(capColour: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), '#e0b48c', 0, 0.22, 0));
  g.add(mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), capColour, 0, 0.25, 0));
  const arm = mesh(new THREE.CapsuleGeometry(0.05, 0.45, 4, 6), '#e0b48c', 0.2, 0.55, 0);
  arm.visible = false;
  g.add(arm);
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), capColour, 0, 0.03, 0));
  return g;
}
