import * as THREE from 'three';
import { hashString, mulberry32, nzDateLabel } from '../../shared/rng';
import { best, burst, controls, disposeTree, frame, helper, mesh, pointer, v3 } from '../kit';
import type { GameZone, ZoneContext } from '../types';

/**
 * Backyard Cricket on the paddock behind the green. The player bats at the wheelie-bin wicket
 * (local origin, facing -Z); a whānau member bowls from 16 m away. Swipe up to swing: the
 * swipe's direction aims the shot, its timing against the ball decides how well you hit it.
 *
 * House rules: can't go out first ball, one hand one bounce (caught after one bounce is out),
 * over the fence is six (and you fetch it, but we let that slide).
 */
const BALLS = 12;
const WICKETS = 3;
const PITCH = 16;
const BOUNDARY = 21;
const GRAVITY = 9.8;
const HIT_Z = -0.9;
/** How far off perfect timing (seconds) still makes contact. */
const WINDOW = 0.2;

type Phase = 'idle' | 'ready' | 'bowling' | 'struck' | 'between' | 'done';
type Outcome = { runs: number; out: boolean; label: string };

export async function createZone(ctx: ZoneContext): Promise<GameZone> {
  const { root, ui } = ctx;
  const rng = mulberry32(hashString(`cricket:${ctx.seed}`));

  // -- The ground ----------------------------------------------------------------
  const strip = mesh(new THREE.PlaneGeometry(2.6, PITCH + 3), '#c9b27a', 0, 0.02, -PITCH / 2 + 0.5);
  strip.rotation.x = -Math.PI / 2;
  root.add(strip);
  // The wicket: a green wheelie bin behind the batter.
  const bin = new THREE.Group();
  bin.add(mesh(new THREE.BoxGeometry(0.58, 0.95, 0.7), '#2f7d3a', 0, 0.5, 0), mesh(new THREE.BoxGeometry(0.62, 0.06, 0.76), '#245f2c', 0, 1.0, -0.02));
  for (const x of [-0.25, 0.25]) {
    const w = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), '#1f2228', x, 0.1, 0.36);
    w.rotation.z = Math.PI / 2;
    bin.add(w);
  }
  bin.position.set(0, 0, 0.55);
  root.add(bin);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(BOUNDARY, 0.05, 6, 120), new THREE.MeshLambertMaterial({ color: '#fbfbf6' }));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(0, 0.05, -PITCH / 2);
  root.add(rope);
  const stumpsAtBowler = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), '#e9e4d8', 0, 0.35, -PITCH - 0.4);
  root.add(stumpsAtBowler);

  // Fielders: the dog and three of the whānau, spread round the paddock.
  const fieldSpots = [v3(-9, 0, -6), v3(10, 0, -9), v3(-6, 0, -17), v3(7, 0, -20)].map((p) => ({ p, r: 1.5 }));
  const fielders = await Promise.all([helper(ctx, 1), helper(ctx, 2), helper(ctx, 3)]);
  fielders.forEach((f, i) => {
    f.root.position.copy(fieldSpots[i].p);
    f.root.rotation.y = Math.atan2(-fieldSpots[i].p.x, -fieldSpots[i].p.z);
    f.play('Idle_B');
  });
  const dog = buildDog();
  dog.position.copy(fieldSpots[3].p);
  root.add(dog);
  const bowler = await helper(ctx, 0);
  bowler.root.position.set(0.4, 0, -PITCH);
  bowler.play('Idle_A');

  const ball = mesh(new THREE.SphereGeometry(0.07, 12, 8), '#d6e83a');
  root.add(ball);
  const bat = mesh(new THREE.BoxGeometry(0.11, 0.85, 0.05), '#c9995a');
  bat.geometry.translate(0, -0.42, 0);
  const spray = burst(70);
  root.add(spray.object);

  // -- State ---------------------------------------------------------------------
  let phase: Phase = 'idle';
  let ballNo = 0;
  let runs = 0;
  let wickets = 0;
  let log: Outcome[] = [];
  let t = 0;
  let pace = 9;
  let line = 0;
  let swingTime = -1;
  let swingAim = 0;
  const vel = v3();
  let bounced = 0;
  let wait = 0;

  const hud = () => {
    ui.subtitle(`Ball ${Math.min(ballNo + 1, BALLS)} of ${BALLS} · ${WICKETS - wickets} wicket${WICKETS - wickets === 1 ? '' : 's'} left`);
    ui.stats([{ label: 'Runs', value: String(runs) }, { label: 'Out', value: `${wickets}/${WICKETS}` }]);
  };

  /** Where the delivery is at time `tt` after release: one bounce, arriving at HIT_Z. */
  const deliveryAt = (tt: number, out = v3()) => {
    const total = (PITCH + HIT_Z * -1) / pace;
    const k = tt / total;
    const z = -PITCH + 0.6 + (PITCH - 0.6 + HIT_Z) * k;
    const bounceK = 0.68;
    const y = k < bounceK ? THREE.MathUtils.lerp(1.9, 0.07, (k / bounceK) ** 1.6) : 0.07 + Math.sin(((k - bounceK) / (1 - bounceK)) * Math.PI * 0.55) * 0.75;
    return out.set(line * k, y, z);
  };
  const arrival = () => (PITCH + HIT_Z * -1) / pace;

  const nextBall = () => {
    if (ballNo >= BALLS || wickets >= WICKETS) return finish();
    phase = 'ready';
    pace = 8 + rng() * 4 + ballNo * 0.25;
    line = (rng() - 0.5) * 0.7;
    swingTime = -1;
    ball.visible = false;
    bowler.play('Idle_A');
    ctx.player.character.play('Melee_Unarmed_Idle');
    hud();
    wait = 0.9;
  };

  const bowl = () => {
    phase = 'bowling';
    t = 0;
    ball.visible = true;
    bowler.play('Throw', { speed: 1.6 });
  };

  /** Swing now, aiming `aim` radians off straight (negative = leg side / left of screen). */
  const swing = (aim: number) => {
    if (phase !== 'bowling' || swingTime >= 0) return;
    swingTime = t;
    swingAim = THREE.MathUtils.clamp(aim, -1.2, 1.2);
    ctx.player.character.play('Melee_Unarmed_Idle');
    batSwing = 0.0001;
  };
  let batSwing = 0;
  let auto = false;
  const autoAim = () => (rng() - 0.5) * 1.6;

  const outcome = (o: Outcome) => {
    log.push(o);
    ballNo++;
    runs += o.runs;
    if (o.out) wickets++;
    ui.toast(o.label, o.out ? 'bad' : o.runs >= 4 ? 'good' : 'info');
    if (o.runs >= 4) {
      spray.fire(ball.position.clone(), 1);
      ctx.player.character.play('Cheering');
    }
    if (o.out) ctx.player.character.play('Hit_A');
    hud();
    phase = 'between';
    wait = 1.4;
  };

  const finish = () => {
    phase = 'done';
    ball.visible = false;
    const b = best('cricket', ctx.seed, runs);
    ui.end(
      {
        title: runs >= 30 ? 'Backyard legend' : runs >= 15 ? 'Good knock' : 'Tough pitch',
        score: `${runs}/${wickets}`,
        grid: log.map((o) => ({ label: o.out ? 'Out' : o.runs === 0 ? 'Dot' : String(o.runs), tone: o.out ? 'bad' : o.runs >= 4 ? 'great' : o.runs ? 'good' : 'neutral' })),
        shareGrid: log.map((o) => (o.out ? '🔴' : o.runs >= 6 ? '🟣' : o.runs >= 4 ? '🟢' : o.runs ? '🟡' : '⚪')).join(''),
        note: b > runs ? `Your best today: ${b} runs` : 'Two overs a day. Same bowling for everyone.',
      },
      ctx.daily ? nzDateLabel() : `#${ctx.seed}`,
    );
  };

  // -- Input: swipe up to swing; left/right of the swipe aims (bound in start()) -------
  let bound: ReturnType<typeof pointer> | null = null;

  const camera = () => frame(ctx, v3(-2.2, 5.2, 9.5), v3(0.3, 0.3, -PITCH * 0.5));

  const zone: GameZone = {
    start() {
      phase = 'idle';
      ballNo = 0;
      runs = 0;
      wickets = 0;
      log = [];
      ctx.player.place(v3(0.45, 0, -0.2), Math.PI);
      ctx.player.character.root.parent?.add(bat);
      camera();
      bound = pointer(ctx, {
        up: (p, s) => {
          const dx = p.x - s.x;
          const dy = s.y - p.y;
          swing(dy < 20 && Math.abs(dx) < 20 ? 0 : Math.atan2(dx, Math.max(dy, 10)));
        },
      });
      ui.hint(controls({
        touch: 'Swipe up as the ball reaches you. Swipe left or right to aim. Fours and sixes over the rope!',
        keyboard: '{Space} to swing as the ball reaches you. Hold {←} or {→} to aim. Fours and sixes over the rope!',
        pad: '{A} to swing as the ball reaches you. Hold the left stick left or right to aim. Fours and sixes over the rope!',
      }));
      nextBall();
    },
    stop() {
      auto = false;
      bound?.release();
      bound = null;
      bat.removeFromParent();
      phase = 'idle';
      ball.visible = false;
    },
    update(dt) {
      spray.update(dt);
      // Keyboard/gamepad: A / Space swings, the stick or arrows aim (full tilt ≈ the widest swipe).
      if (phase === 'bowling' && ctx.input.confirm()) swing(ctx.input.stick().x * 1.1);
      // Bat follows the player's right hand side and sweeps when swinging.
      const pr = ctx.player.character.root;
      bat.position.copy(pr.position).add(v3(-0.32, 1.05, 0).applyAxisAngle(v3(0, 1, 0), pr.rotation.y));
      if (batSwing > 0) {
        batSwing += dt * 5;
        bat.rotation.set(0, pr.rotation.y + swingAim, -Math.min(batSwing, 1) * 2.4 + 0.3);
        if (batSwing > 1.4) batSwing = 0;
      } else bat.rotation.set(0, pr.rotation.y, 0.35);

      if (phase === 'ready' || phase === 'between') {
        wait -= dt;
        if (wait <= 0) phase === 'ready' ? bowl() : nextBall();
        return;
      }
      if (phase === 'bowling') {
        t += dt;
        deliveryAt(t, ball.position);
        const arrive = arrival();
        if (auto && swingTime < 0 && t >= arrive - 0.02) swing(autoAim());
        if (swingTime >= 0 && Math.abs(swingTime - arrive) < WINDOW) {
          // Contact. Timing decides power and height; the swipe decides direction.
          const quality = 1 - Math.abs(swingTime - arrive) / WINDOW;
          const speed = 9 + quality * 17 + rng() * 3;
          const loft = 0.2 + quality * 0.55 + rng() * 0.15;
          const dir = v3(Math.sin(swingAim), 0, -Math.cos(swingAim));
          vel.copy(dir).multiplyScalar(speed * Math.cos(loft));
          vel.y = speed * Math.sin(loft);
          ball.position.set(0, 0.8, HIT_Z);
          bounced = 0;
          phase = 'struck';
          return;
        }
        if (t > arrive + 0.15) {
          const early = swingTime >= 0 && swingTime < arrive;
          const bowled = Math.abs(line) < 0.28;
          if (bowled && ballNo > 0) outcome({ runs: 0, out: true, label: early ? 'Too early! Bowled.' : 'Bowled! Hit the bin.' });
          else outcome({ runs: 0, out: false, label: bowled ? "Can't go out first ball!" : swingTime < 0 ? 'Left it. Dot ball.' : 'Swing and a miss' });
        }
        return;
      }
      if (phase === 'struck') {
        vel.y -= GRAVITY * dt;
        ball.position.addScaledVector(vel, dt);
        const flat = Math.hypot(ball.position.x, ball.position.z + PITCH / 2);
        if (ball.position.y <= 0.07) {
          ball.position.y = 0.07;
          bounced++;
          if (bounced === 1 && flat > BOUNDARY) return outcome({ runs: 6, out: false, label: 'Over the rope! Six!' });
          // One hand, one bounce: a fielder close to the first bounce takes the catch.
          if (bounced === 1 && ballNo > 0) {
            for (const f of fieldSpots) {
              if (f.p.distanceTo(v3(ball.position.x, 0, ball.position.z)) < f.r) return outcome({ runs: 0, out: true, label: 'One hand, one bounce. Out!' });
            }
          }
          vel.y = Math.abs(vel.y) * 0.35;
          vel.x *= 0.6;
          vel.z *= 0.6;
        }
        if (flat > BOUNDARY) return outcome({ runs: 4, out: false, label: 'Four along the ground!' });
        if (vel.length() < 1.2) {
          const r = flat > 14 ? 3 : flat > 9 ? 2 : flat > 4 ? 1 : 0;
          return outcome({ runs: r, out: false, label: r ? `${r} run${r > 1 ? 's' : ''}` : 'Blocked. Dot ball.' });
        }
      }
    },
    dispose() {
      zone.stop();
      disposeTree(root);
    },
    debug: {
      state: () => ({ phase, ballNo, runs, wickets, swung: swingTime >= 0, log: log.map((o) => o.label) }),
      /** Swings at the perfect moment for the current ball (tests). */
      perfect: (aim = 0) => {
        if (phase !== 'bowling') return false;
        const left = arrival() - t;
        window.setTimeout(() => swing(aim), Math.max(0, left * 1000 - 10));
        return true;
      },
      autoplay: async () => {
        auto = true;
        while (phase !== 'done') await new Promise((r) => window.setTimeout(r, 100));
        auto = false;
      },
    },
  };
  return zone;
}

function buildDog(): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 8), '#8a5a33', 0, 0.42, 0);
  body.rotation.x = Math.PI / 2;
  const head = mesh(new THREE.SphereGeometry(0.17, 10, 8), '#8a5a33', 0, 0.62, -0.42);
  const snout = mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), '#6b4426', 0, 0.58, -0.58);
  g.add(body, head, snout);
  for (const [x, z] of [[-0.12, -0.25], [0.12, -0.25], [-0.12, 0.25], [0.12, 0.25]]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), '#6b4426', x, 0.15, z));
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), '#6b4426', s * 0.12, 0.74, -0.38));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.3, 5), '#8a5a33', 0, 0.55, 0.42));
  return g;
}
