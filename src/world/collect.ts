import * as THREE from 'three';
import { CHARACTERS, createCharacter, type Character } from '../character/character';
import { box, cyl, group, paint } from './build';
import { cameraStand } from './props';
import { groundHeight, HEADLAND } from './terrain';

/**
 * Reasons to wander: native birds to spot, viewpoints that give you a postcard, and a few
 * small jobs for the locals. Nothing here is tied to the sponsor or to buying anything
 * (see docs/compliance.md). Progress is kept in local storage only.
 *
 * Bird names need checking by a te reo Māori reviewer before launch.
 */
interface Bird {
  id: string;
  name: string;
  english: string;
  fact: string;
  colour: string;
  x: number;
  z: number;
  /** Height above the ground it perches at. */
  perch: number;
}

const BIRDS: Bird[] = [
  { id: 'tui', name: 'Tūī', english: 'Tūī', fact: 'Loves pōhutukawa nectar.', colour: '#1f3b4d', x: 2, z: 79, perch: 4.6 },
  { id: 'piwakawaka', name: 'Pīwakawaka', english: 'Fantail', fact: 'Follows walkers to catch the insects they stir up.', colour: '#8a6a45', x: 35, z: -74, perch: 1.6 },
  { id: 'kereru', name: 'Kererū', english: 'Wood pigeon', fact: 'The only bird big enough to spread some native tree seeds.', colour: '#3f6b5c', x: 84, z: -112, perch: 3.2 },
  { id: 'korimako', name: 'Korimako', english: 'Bellbird', fact: 'Its song rings like a bell at dawn.', colour: '#7c9a3a', x: 140, z: -138, perch: 2.2 },
  { id: 'tauhou', name: 'Tauhou', english: 'Silvereye', fact: 'Look for the white ring around its eye.', colour: '#9fb04a', x: -150, z: -10, perch: 2.9 },
  { id: 'riroriro', name: 'Riroriro', english: 'Grey warbler', fact: 'Tiny bird, big wavering song.', colour: '#9a9a8c', x: -8, z: -100, perch: 1.8 },
  { id: 'kotare', name: 'Kōtare', english: 'Kingfisher', fact: 'Perches above water, watching for a meal.', colour: '#1c8fa6', x: 131, z: 22.6, perch: 1.85 },
  { id: 'torea', name: 'Tōrea', english: 'Oystercatcher', fact: 'Probes the wet sand with its long red bill.', colour: '#1b1b1f', x: -176, z: 124, perch: 0.05 },
  { id: 'karoro', name: 'Karoro', english: 'Black-backed gull', fact: 'Will absolutely have your chips.', colour: '#f4f4ee', x: -45, z: 151, perch: 0.62 },
  { id: 'pukeko', name: 'Pūkeko', english: 'Pūkeko', fact: 'Struts about wet paddocks on long red legs.', colour: '#2a3f9a', x: -168, z: -92, perch: 0.05 },
];

interface Viewpoint {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Which way the camera stand faces. */
  yaw: number;
}

const VIEWPOINTS: Viewpoint[] = [
  { id: 'tree', name: 'The Christmas tree', x: 30, z: 0.5, yaw: Math.PI },
  { id: 'street', name: 'Main street', x: -58, z: 15.4, yaw: -Math.PI / 2 },
  { id: 'bach', name: 'Bach Road', x: -94, z: 17, yaw: Math.PI },
  { id: 'beach', name: 'The beach', x: 62, z: 94, yaw: 0 },
  { id: 'flags', name: 'Between the flags', x: 21, z: 101, yaw: 0 },
  { id: 'wharf', name: 'End of the wharf', x: -46.6, z: 149, yaw: 0 },
  { id: 'camp', name: 'The campground', x: -132, z: 40, yaw: 0 },
  { id: 'rocks', name: 'Rock pools', x: -164, z: 112, yaw: -1.2 },
  { id: 'farm', name: 'The farm', x: -124, z: -88, yaw: Math.PI },
  { id: 'clearing', name: 'Bush clearing', x: 31, z: -104, yaw: Math.PI },
  { id: 'falls', name: 'The waterfall', x: 146, z: -139, yaw: Math.PI },
  { id: 'lighthouse', name: 'Lighthouse lookout', x: HEADLAND.x - 6.5, z: HEADLAND.z + 6.5, yaw: -2.2 },
];

interface Job {
  id: string;
  who: string;
  giver: { x: number; z: number; yaw: number; cast: number };
  ask: string;
  item: { x: number; z: number; name: string; build: () => THREE.Object3D };
  thanks: string;
}

const JOBS: Job[] = [
  {
    id: 'jandal', who: 'Nana',
    giver: { x: -111.5, z: 10.6, yaw: 0.3, cast: 1 },
    ask: "I left a jandal on the beach by the pink umbrella. Could you fetch it, love?",
    item: { x: -27, z: 98.5, name: "Nana's jandal", build: () => group(box(0.22, 0.05, 0.5, '#e8578e', 0, 0.03, 0), box(0.2, 0.03, 0.04, '#fbfbf6', 0, 0.08, -0.08)) },
    thanks: 'Choice! Both feet sorted.',
  },
  {
    id: 'ball', who: 'Kev',
    giver: { x: 12, z: -9, yaw: 1.2, cast: 0 },
    ask: 'Six and out! The ball went into a back yard up Bach Road. The yellow bach, I reckon.',
    item: { x: -124, z: -31, name: 'the cricket ball', build: () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), paint('#b3271e')); m.position.y = 0.11; return m; } },
    thanks: 'Legend. Game back on!',
  },
  {
    id: 'pav', who: 'Aunty Mere',
    giver: { x: 88, z: 15.2, yaw: 0, cast: 3 },
    ask: "The pav for the hall is still at the campground BBQ shelter. Carry it carefully!",
    item: { x: -124.6, z: 51.2, name: 'the pavlova', build: () => group(cyl(0.3, 0.34, 0.2, '#fbfbf6', 0, 0.1, 0, 14), cyl(0.2, 0.26, 0.1, '#fffdf4', 0, 0.24, 0, 12), cyl(0.05, 0.05, 0.05, '#d7263d', 0.08, 0.31, 0.03, 8), cyl(0.05, 0.05, 0.05, '#7cb342', -0.07, 0.31, -0.05, 8)) },
    thanks: 'Not a crack in it. You are a treasure.',
  },
];

const STORE = 'kiwi-christmas:progress';

interface Saved {
  birds: string[];
  cards: Record<string, string>;
  jobs: string[];
}

export interface Collect {
  update(dt: number, elapsed: number, player: THREE.Vector3): void;
  /** HTML for the progress page in the map sheet. */
  html(): string;
  counts(): { birds: number; cards: number; jobs: number; total: number; found: number };
}

export async function buildCollect(
  scene: THREE.Scene,
  opts: { toast(title: string, body: string): void; snapshot(): string; onChange(): void },
): Promise<Collect> {
  let saved: Saved = { birds: [], cards: {}, jobs: [] };
  try {
    saved = { ...saved, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Saved>) };
  } catch {
    // Storage blocked or corrupt: start fresh for this visit.
  }
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      // Out of space or blocked: progress just lasts for this visit.
    }
    opts.onChange();
  };

  // -- Birds ----------------------------------------------------------------
  const birds = BIRDS.map((bird) => {
    const mesh = buildBird(bird);
    mesh.position.set(bird.x, groundHeight(bird.x, bird.z) + bird.perch, bird.z);
    mesh.rotation.y = (bird.x * 7) % 6.28;
    scene.add(mesh);
    return { bird, mesh, baseY: mesh.position.y };
  });

  // -- Postcards --------------------------------------------------------------
  const stands = VIEWPOINTS.map((view) => {
    const stand = cameraStand();
    stand.position.set(view.x, groundHeight(view.x, view.z), view.z);
    stand.rotation.y = view.yaw;
    scene.add(stand);
    return { view, stand };
  });
  let pendingCard: Viewpoint | null = null;
  let cardDelay = 0;

  // -- Jobs -------------------------------------------------------------------
  const marker = () => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }));
    return m;
  };
  const jobs = await Promise.all(
    JOBS.map(async (job) => {
      const giver: Character = await createCharacter(CHARACTERS[job.giver.cast]);
      const gy = groundHeight(job.giver.x, job.giver.z);
      giver.root.position.set(job.giver.x, gy, job.giver.z);
      giver.root.rotation.y = job.giver.yaw;
      giver.play('Idle_B');
      scene.add(giver.root);
      const flag = marker();
      flag.position.set(job.giver.x, gy + 2.7, job.giver.z);
      scene.add(flag);
      const item = job.item.build();
      item.position.set(job.item.x, groundHeight(job.item.x, job.item.z), job.item.z);
      item.visible = false;
      const itemFlag = marker();
      itemFlag.position.y = 1.2;
      item.add(itemFlag);
      scene.add(item);
      const done = saved.jobs.includes(job.id);
      flag.visible = !done;
      return { job, giver, flag, item, itemFlag, stage: done ? 3 : 0 };
    }),
  );

  const counts = () => {
    const found = saved.birds.length + Object.keys(saved.cards).length + saved.jobs.length;
    return { birds: saved.birds.length, cards: Object.keys(saved.cards).length, jobs: saved.jobs.length, total: BIRDS.length + VIEWPOINTS.length + JOBS.length, found };
  };

  return {
    counts,
    update(dt, elapsed, player) {
      for (const { bird, mesh, baseY } of birds) {
        mesh.position.y = baseY + Math.abs(Math.sin(elapsed * 3 + bird.x)) * 0.05;
        mesh.rotation.y += Math.sin(elapsed * 0.8 + bird.z) * dt * 0.8;
        if (saved.birds.includes(bird.id)) continue;
        if (Math.hypot(bird.x - player.x, bird.z - player.z) < 6.5) {
          saved.birds.push(bird.id);
          save();
          opts.toast(`Spotted: ${bird.name}`, bird.name === bird.english ? bird.fact : `${bird.english}. ${bird.fact}`);
        }
      }

      for (const { view, stand } of stands) {
        const taken = view.id in saved.cards;
        (stand.children[2] as THREE.Mesh).visible = !taken;
        stand.children[2].position.y = 2.1 + Math.sin(elapsed * 2.5 + view.x) * 0.06;
        if (!taken && !pendingCard && Math.hypot(view.x - player.x, view.z - player.z) < 2.2) {
          pendingCard = view;
          cardDelay = 0.15;
        }
      }
      if (pendingCard) {
        cardDelay -= dt;
        if (cardDelay <= 0) {
          saved.cards[pendingCard.id] = opts.snapshot();
          save();
          opts.toast('Postcard added', pendingCard.name);
          pendingCard = null;
        }
      }

      for (const j of jobs) {
        j.giver.update(dt);
        j.flag.rotation.y = elapsed * 2;
        j.itemFlag.rotation.y = elapsed * 2;
        if (j.stage === 3) continue;
        const toGiver = Math.hypot(j.job.giver.x - player.x, j.job.giver.z - player.z);
        const toItem = Math.hypot(j.job.item.x - player.x, j.job.item.z - player.z);
        if (j.stage === 0 && toGiver < 2.6) {
          j.stage = 1;
          j.flag.visible = false;
          j.item.visible = true;
          j.giver.play('Waving', { then: () => j.giver.play('Idle_B') });
          opts.toast(j.job.who, j.job.ask);
        } else if (j.stage === 1 && toItem < 1.8) {
          j.stage = 2;
          j.item.visible = false;
          j.flag.visible = true;
          opts.toast(`Got ${j.job.item.name}`, `Take it back to ${j.job.who}.`);
        } else if (j.stage === 2 && toGiver < 2.6) {
          j.stage = 3;
          j.flag.visible = false;
          saved.jobs.push(j.job.id);
          save();
          j.giver.play('Cheering', { then: () => j.giver.play('Idle_B') });
          opts.toast(`${j.job.who}: job done`, j.job.thanks);
        }
      }
    },
    html() {
      const c = counts();
      const bird = (b: Bird) => {
        const got = saved.birds.includes(b.id);
        return `<li class="${got ? 'got' : ''}"><i style="background:${got ? b.colour : 'transparent'}"></i><b>${got ? b.name : '???'}</b><small>${got ? b.english : 'Not spotted yet'}</small></li>`;
      };
      const card = (v: Viewpoint) => {
        const src = saved.cards[v.id];
        return `<figure class="${src ? 'got' : ''}">${src ? `<img src="${src}" alt="Postcard: ${v.name}">` : '<div></div>'}<figcaption>${src ? v.name : '???'}</figcaption></figure>`;
      };
      const job = (j: Job) => `<li class="${saved.jobs.includes(j.id) ? 'got' : ''}"><i></i><b>${j.who}</b><small>${saved.jobs.includes(j.id) ? 'Done' : 'Has a job for you'}</small></li>`;
      return `
        <p class="progress-total">${c.found} of ${c.total} found</p>
        <h3>Bird notebook <span>${c.birds}/${BIRDS.length}</span></h3>
        <ul class="found-list">${BIRDS.map(bird).join('')}</ul>
        <h3>Postcards <span>${c.cards}/${VIEWPOINTS.length}</span></h3>
        <div class="cards">${VIEWPOINTS.map(card).join('')}</div>
        <h3>Summer jobs <span>${c.jobs}/${JOBS.length}</span></h3>
        <ul class="found-list">${JOBS.map(job).join('')}</ul>`;
    },
  };
}

function buildBird(bird: Bird): THREE.Group {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), paint(bird.colour));
  body.scale.set(1, 0.95, 1.3);
  body.position.y = 0.2;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), paint(bird.colour));
  head.position.set(0, 0.36, 0.13);
  const beakColour = bird.id === 'torea' || bird.id === 'pukeko' ? '#d7263d' : bird.id === 'karoro' ? '#f2c03a' : '#2a2a2a';
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, bird.id === 'torea' ? 0.22 : 0.1, 5), paint(beakColour));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.36, 0.27);
  const g = group(body, head, beak, box(0.1, 0.02, 0.22, bird.colour, 0, 0.22, -0.26));
  if (bird.id === 'tui') g.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), paint('#ffffff')).translateY(0.28).translateZ(0.2));
  if (bird.id === 'karoro') g.add(box(0.3, 0.04, 0.3, '#2a2d33', 0, 0.3, -0.05));
  if (bird.id === 'torea' || bird.id === 'pukeko') for (const s of [-1, 1]) g.add(box(0.02, 0.2, 0.02, '#d7263d', s * 0.06, 0.0, 0));
  if (bird.id === 'piwakawaka') {
    const tail = new THREE.Mesh(new THREE.CircleGeometry(0.24, 8, 0.4, 2.3), new THREE.MeshLambertMaterial({ color: '#f4f4ee', side: THREE.DoubleSide }));
    tail.position.set(0, 0.26, -0.24);
    tail.rotation.x = -0.9;
    g.add(tail);
  }
  if (bird.id === 'torea' || bird.id === 'pukeko') g.position.y = 0.1;
  g.scale.setScalar(1.5);
  return g;
}
