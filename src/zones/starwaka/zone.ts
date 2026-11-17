import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/terrain';
import { best, disposeTree, frame, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Star Waka at the end of the wharf, at night. Steer so the guide star sits over the bow. Stars
 * rise from the same point on the horizon one after another; as one climbs too high to steer
 * by, the next rises in its place, and you switch to it. Hold your course for the voyage.
 *
 * GATED: hidden from the public world (only shown with ?preview). Wayfinding is mātauranga
 * Māori; this needs a genuine partnership (for example with a waka hourua trust), including
 * which star names and teachings are shared, before it can be shown to anyone. Stars here are
 * deliberately unnamed.
 */
const VOYAGE = 60;
const TOO_HIGH = 35;
const RISE_RATE = 2.6; // degrees a second
const ON_COURSE = 6;
const LEGS = [0, 14, -9];

type Phase = 'idle' | 'sail' | 'done';
const deg = THREE.MathUtils.degToRad;

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const seaY = SEA_LEVEL - root.position.y;

  // -- The waka hourua: two hulls, a deck between them, a sail ------------------------------
  const waka = new THREE.Group();
  for (const x of [-0.9, 0.9]) {
    const hull = mesh(new THREE.CapsuleGeometry(0.28, 4.2, 4, 10).rotateX(Math.PI / 2), '#5b3a22', x, 0.1, 0);
    hull.scale.y = 0.7;
    waka.add(hull, mesh(new THREE.ConeGeometry(0.12, 0.6, 6).rotateX(-Math.PI / 2), '#3b2a1a', x, 0.45, -2.5));
  }
  waka.add(mesh(new THREE.BoxGeometry(2.1, 0.08, 2.2), '#8a6a45', 0, 0.35, 0.3));
  waka.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6), '#6b4a2f', 0, 2.05, 0));
  const sail = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 3, 1, true), new THREE.MeshLambertMaterial({ color: '#c9a77a', side: THREE.DoubleSide }));
  sail.position.set(0, 2.2, 0.2);
  sail.rotation.y = Math.PI / 2;
  waka.add(sail);
  waka.position.set(0, seaY, -9);
  root.add(waka);
  const bowMark = mesh(new THREE.ConeGeometry(0.08, 0.25, 6).rotateX(-Math.PI / 2), '#ffd23f', 0, 0.55, -2.9);
  const bowMat = new THREE.MeshBasicMaterial({ color: '#ffd23f' });
  bowMark.material = bowMat;
  waka.add(bowMark);

  // -- The sky --------------------------------------------------------------------------
  const R = 90;
  // Stars: small instanced discs on a dome (GL points have no size under WebGPU).
  const starMat = new THREE.MeshBasicMaterial({ color: '#dfe8ff', transparent: true, opacity: 0, fog: false, depthWrite: false });
  const sky = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), starMat, 900);
  {
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 900; i++) {
      const az = Math.random() * Math.PI * 2;
      const alt = Math.asin(Math.random() * 0.98 + 0.02);
      const s = 0.5 + Math.random() * 1.2;
      m4.makeScale(s, s, s).setPosition(Math.sin(az) * Math.cos(alt) * R, Math.sin(alt) * R, -Math.cos(az) * Math.cos(alt) * R);
      sky.setMatrixAt(i, m4);
    }
    sky.frustumCulled = false;
  }
  root.add(sky);
  const guides = Array.from({ length: 6 }, () => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false, transparent: true }));
    s.visible = false;
    root.add(s);
    return s;
  });

  // -- State ---------------------------------------------------------------------------
  let phase: Phase = 'idle';
  let t = 0;
  let heading = 0;
  let guide = 0;
  let onCourse = 0;
  let auto = false;
  let bound: ReturnType<typeof pointer> | null = null;
  let lastX = 0;
  const risen: number[] = [];

  const legBearing = () => LEGS[Math.min(LEGS.length - 1, Math.floor((t / VOYAGE) * LEGS.length))];
  const starAt = (i: number) => {
    const alt = Math.max(0, (t - risen[i]) * RISE_RATE);
    const az = legBearing() + alt * 0.35;
    return { alt, az };
  };
  const placeStar = (i: number) => {
    const { alt, az } = starAt(i);
    const a = deg(az);
    const h = deg(alt);
    guides[i].position.set(waka.position.x + Math.sin(a) * Math.cos(h) * R * 0.6, waka.position.y + Math.sin(h) * R * 0.6, waka.position.z - Math.cos(a) * Math.cos(h) * R * 0.6);
  };

  const hud = () => {
    const s = starAt(guide);
    ui.subtitle(s.alt > TOO_HIGH ? 'Your star is too high to steer by. Switch to the new one!' : 'Keep the guide star over the bow');
    ui.stats([{ label: 'Voyage', value: `${Math.round((t / VOYAGE) * 100)}%` }, { label: 'On course', value: `${t ? Math.round((onCourse / t) * 100) : 100}%` }]);
  };

  const sheetEl = document.createElement('div');
  sheetEl.innerHTML = `
    <p class="review-note">Preview only. Wayfinding is mātauranga Māori: this needs a partnership with wayfinding experts before anyone else sees it.</p>
    <div class="tool-row three"><button class="btn" data-l>◀ Steer</button><button class="btn btn-primary" data-next>Next star</button><button class="btn" data-r>Steer ▶</button></div>`;
  let steer = 0;
  for (const [sel, dir] of [['[data-l]', -1], ['[data-r]', 1]] as [string, number][]) {
    const b = sheetEl.querySelector<HTMLButtonElement>(sel)!;
    b.addEventListener('pointerdown', () => (steer = dir));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => (steer = 0));
  }
  sheetEl.querySelector('[data-next]')!.addEventListener('click', () => nextStar());

  const nextStar = () => {
    const newest = risen.length - 1;
    if (guide < newest) {
      guides[guide].visible = false;
      guide = newest;
      ui.toast('New guide star', 'good');
    } else ui.toast('Wait for the next star to rise', 'info');
  };

  const finish = () => {
    phase = 'done';
    ui.sheet(null);
    const pct = Math.round((onCourse / VOYAGE) * 100);
    const b = best('starwaka', 'all', pct);
    ui.end(
      {
        title: pct >= 80 ? 'Land ahoy!' : pct >= 50 ? 'Drifted, but made landfall' : 'Lost at sea (for now)',
        score: `${pct}% on course`,
        shareGrid: '⭐🛶',
        note: `Preview build for review with a wayfinding partner.${b > pct ? ` Best: ${b}%.` : ''}`,
      },
      'preview',
    );
  };

  const zone: GameZone = {
    start() {
      phase = 'sail';
      t = 0;
      heading = 25;
      guide = 0;
      onCourse = 0;
      risen.length = 0;
      risen.push(-4);
      guides.forEach((g) => (g.visible = false));
      ctx.setNight(1);
      ctx.player.place(v3(0, 0, 1.2), Math.PI);
      ui.sheet(sheetEl);
      bound = pointer(ctx, {
        down: (p) => (lastX = p.x),
        move: (p) => {
          heading += (p.x - lastX) * 0.12;
          lastX = p.x;
        },
      });
      ui.hint('Drag left and right (or hold the steer buttons) to keep the bright star over the bow.');
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      phase = 'idle';
      ui.sheet(null);
      ctx.setNight(0);
      guides.forEach((g) => (g.visible = false));
    },
    update(dt, elapsed) {
      starMat.opacity += ((phase === 'sail' ? 1 : 0) - starMat.opacity) * Math.min(1, dt * 2);
      waka.position.y = seaY + Math.sin(elapsed * 1.3) * 0.06;
      waka.rotation.z = Math.sin(elapsed * 0.9) * 0.03;
      if (phase !== 'sail') return;
      t += dt;
      heading += steer * 22 * dt;
      // A new star rises roughly every 13 s from the same point on the horizon.
      if (t - risen[risen.length - 1] > 13) risen.push(t);
      for (let i = 0; i < risen.length && i < guides.length; i++) {
        guides[i].visible = i >= guide;
        placeStar(i);
        (guides[i].material as THREE.MeshBasicMaterial).opacity = i === guide ? 1 : 0.55;
        guides[i].scale.setScalar(i === guide ? 1.2 : 0.8);
      }
      const s = starAt(guide);
      if (auto) {
        heading += (s.az - heading) * Math.min(1, dt * 3);
        if (s.alt > TOO_HIGH - 4 && risen.length - 1 > guide) nextStar();
      }
      // A star too high up can't be steered by: you drift, even if you're lined up under it.
      const err = s.alt > TOO_HIGH ? 99 : Math.abs(heading - s.az);
      if (err < ON_COURSE) onCourse += dt;
      bowMat.color.set(err < ON_COURSE ? '#2f9e5a' : '#ffd23f');
      waka.rotation.y = -deg(heading);
      // Sit in the stern looking past the bow at the horizon.
      const back = v3(Math.sin(deg(heading)), 0, -Math.cos(deg(heading)));
      frame(ctx, waka.position.clone().addScaledVector(back, -6.5).add(v3(0, 4.6, 0)), waka.position.clone().addScaledVector(back, 30).add(v3(0, 9, 0)), 5);
      hud();
      if (t >= VOYAGE) finish();
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, t: Math.round(t), heading: Math.round(heading), guide, onCourse: Math.round(onCourse) }),
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 200));
        auto = false;
      },
    },
  };
  return zone;
}
