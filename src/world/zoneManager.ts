import * as THREE from 'three';
import type { CameraRig } from '../engine/cameraRig';
import type { Input } from '../engine/input';
import type { PlayerController } from '../character/controller';
import type { GameZone, ZoneContext, ZoneDef } from '../zones/types';
import { icon } from './icons';
import { ZoneUi } from './zoneUi';
import { ZONES } from './zones';
import { groundHeight } from './terrain';

const BUILD_RADIUS = 46;
const DISPOSE_RADIUS = 70;
const PROMPT_RADIUS = 2.6;

interface Slot {
  def: ZoneDef;
  root: THREE.Group;
  marker: THREE.Group;
  label: HTMLElement;
  zone: GameZone | null;
  loading: Promise<void> | null;
}

/**
 * Builds each game's set as the player gets near it, disposes it when they walk away, shows
 * the "Play" prompt in its ring, and hands control to the zone while it is played.
 */
export class ZoneManager {
  readonly ui = new ZoneUi();
  private readonly slots: Slot[] = [];
  private active: Slot | null = null;
  private near: Slot | null = null;
  private readonly prompt: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly projected = new THREE.Vector3();
  onEnter: (def: ZoneDef) => void = () => {};
  onExit: () => void = () => {};

  constructor(
    private readonly opts: {
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      rig: CameraRig;
      canvas: HTMLCanvasElement;
      input: Input;
      player: PlayerController;
      setNight(amount: number): void;
      seed: string;
      daily: boolean;
      preview: boolean;
    },
  ) {
    this.labels = document.createElement('div');
    this.labels.className = 'world-labels';
    document.body.appendChild(this.labels);
    this.prompt = document.createElement('div');
    this.prompt.className = 'zone-prompt';
    this.prompt.hidden = true;
    document.body.appendChild(this.prompt);

    for (const def of ZONES) {
      if (def.gated && !opts.preview) continue;
      const root = new THREE.Group();
      root.name = `zone:${def.id}`;
      root.position.set(def.x, groundHeight(def.x, def.z), def.z);
      root.rotation.y = def.facing;
      opts.scene.add(root);
      const marker = buildMarker(!!def.load);
      marker.position.copy(this.toWorld(root, new THREE.Vector3(def.start.x, 0, def.start.z)));
      marker.position.y = groundHeight(marker.position.x, marker.position.z) + 0.05;
      opts.scene.add(marker);
      const label = document.createElement('div');
      label.className = `world-label ${def.load ? '' : 'is-soon'}`;
      label.innerHTML = `<b>${def.title}</b><span>${def.load ? (def.kind === 'learn' ? 'Learn & play' : 'Play') : 'Coming soon'}</span>`;
      this.labels.appendChild(label);
      this.slots.push({ def, root, marker, label, zone: null, loading: null });
    }
  }

  get playing(): boolean {
    return this.active !== null;
  }

  get list(): { def: ZoneDef; position: THREE.Vector3 }[] {
    return this.slots.map((s) => ({ def: s.def, position: s.marker.position.clone() }));
  }

  private toWorld(root: THREE.Group, local: THREE.Vector3): THREE.Vector3 {
    root.updateMatrixWorld(true);
    return local.clone().applyMatrix4(root.matrixWorld);
  }

  private context(slot: Slot): ZoneContext {
    const { opts } = this;
    return {
      scene: opts.scene,
      camera: opts.camera,
      rig: opts.rig,
      canvas: opts.canvas,
      ui: this.ui,
      root: slot.root,
      seed: opts.seed,
      daily: opts.daily,
      setNight: opts.setNight,
      player: {
        character: opts.player.character,
        place: (local, yaw) => {
          const p = this.toWorld(slot.root, local);
          opts.player.place(p.x, p.z, yaw + slot.def.facing);
        },
      },
      exit: () => this.leave(),
    };
  }

  /** Builds the zone once; callers that arrive while it is loading wait for the same load. */
  private build(slot: Slot): Promise<void> {
    if (!slot.def.load || slot.zone) return Promise.resolve();
    if (slot.loading) return slot.loading;
    slot.loading = (async () => {
      try {
        const mod = await slot.def.load!();
        slot.zone = await mod.createZone(this.context(slot));
      } catch (err) {
        console.error(`Zone ${slot.def.id} failed to load`, err);
      } finally {
        slot.loading = null;
      }
    })();
    return slot.loading;
  }

  private dispose(slot: Slot): void {
    if (!slot.zone || slot === this.active) return;
    slot.zone.dispose();
    slot.zone = null;
    slot.root.clear();
  }

  /** Enter the zone the player is standing in (if it's playable). */
  async enter(slot = this.near): Promise<void> {
    if (!slot || !slot.def.load || this.active) return;
    if (!slot.zone) await this.build(slot);
    if (!slot.zone) return;
    this.active = slot;
    this.prompt.hidden = true;
    this.opts.input.enabled = false;
    this.opts.player.active = false;
    this.labels.hidden = true;
    for (const s of this.slots) s.marker.visible = false;
    this.onEnter(slot.def);
    this.ui.open(slot.def.title, {
      leave: () => this.leave(),
      replay: () => {
        this.ui.hideEnd();
        slot.zone?.stop();
        slot.zone?.start();
      },
    });
    (window as unknown as { __zone?: unknown }).__zone = slot.zone.debug;
    slot.zone.start();
  }

  leave(): void {
    const slot = this.active;
    if (!slot) return;
    slot.zone?.stop();
    this.active = null;
    this.ui.close();
    this.opts.setNight(0);
    this.opts.input.enabled = true;
    this.opts.player.active = true;
    this.opts.player.character.play('Idle_A');
    this.labels.hidden = false;
    for (const s of this.slots) s.marker.visible = true;
    // Step the player out of the ring so the prompt doesn't pop straight back up.
    const out = this.toWorld(slot.root, new THREE.Vector3(slot.def.start.x, 0, slot.def.start.z + PROMPT_RADIUS + 0.6));
    this.opts.player.place(out.x, out.z, slot.def.facing);
    this.opts.rig.yaw = slot.def.facing;
    this.opts.rig.follow();
    delete (window as unknown as { __zone?: unknown }).__zone;
    this.onExit();
  }

  update(dt: number, elapsed: number): void {
    const p = this.opts.player.position;
    let nearest: Slot | null = null;
    for (const slot of this.slots) {
      const d = Math.hypot(slot.marker.position.x - p.x, slot.marker.position.z - p.z);
      const centre = Math.hypot(slot.root.position.x - p.x, slot.root.position.z - p.z);
      if (centre < BUILD_RADIUS) void this.build(slot);
      else if (centre > DISPOSE_RADIUS) this.dispose(slot);
      // Tests can fast-forward games (the headless browser runs at a few frames a second).
      const speed = slot === this.active ? ((window as unknown as { __zoneSpeed?: number }).__zoneSpeed ?? 1) : 1;
      slot.zone?.update(dt * speed, elapsed);
      if (!this.active && d < PROMPT_RADIUS) nearest = slot;
      // Pulsing ring.
      const ring = slot.marker.children[0];
      ring.scale.setScalar(1 + Math.sin(elapsed * 3 + slot.root.position.x) * 0.04);
      (slot.marker.children[1] as THREE.Mesh).position.y = 2.4 + Math.sin(elapsed * 2.4) * 0.15;
      this.placeLabel(slot, d);
    }
    if (nearest !== this.near) {
      this.near = nearest;
      this.showPrompt(nearest);
    }
  }

  private placeLabel(slot: Slot, distance: number): void {
    const el = slot.label;
    if (this.active || distance > 60) {
      el.style.opacity = '0';
      return;
    }
    this.projected.copy(slot.marker.position).setY(slot.marker.position.y + 3.3).project(this.opts.camera);
    if (this.projected.z > 1) {
      el.style.opacity = '0';
      return;
    }
    const x = ((this.projected.x + 1) / 2) * window.innerWidth;
    const y = ((1 - this.projected.y) / 2) * window.innerHeight;
    el.style.opacity = String(THREE.MathUtils.clamp((60 - distance) / 12, 0, 1));
    el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
  }

  private showPrompt(slot: Slot | null): void {
    if (!slot) {
      this.prompt.hidden = true;
      return;
    }
    const { def } = slot;
    this.prompt.innerHTML = `
      <div class="prompt-text">
        <span class="prompt-kind">${def.kind === 'learn' ? 'Learn & play' : 'Play'}</span>
        <b>${def.title}</b>
        <p>${def.blurb}</p>
      </div>
      ${def.load
        ? `<button class="btn btn-primary btn-play">${icon('play')}<span>Play</span></button>`
        : `<div class="soon-pill">${icon('lock', 18)}<span>Coming soon</span></div>`}`;
    this.prompt.querySelector('.btn-play')?.addEventListener('click', () => void this.enter(slot));
    this.prompt.hidden = false;
  }

  /** Keyboard E / Enter. */
  interact(): void {
    if (this.near && !this.active) void this.enter(this.near);
  }

  /** For tests: jump straight into a zone. */
  async enterById(id: string): Promise<boolean> {
    const slot = this.slots.find((s) => s.def.id === id);
    if (!slot) return false;
    const start = this.toWorld(slot.root, new THREE.Vector3(slot.def.start.x, 0, slot.def.start.z));
    this.opts.player.place(start.x, start.z, slot.def.facing);
    await this.enter(slot);
    return this.active === slot;
  }
}

function buildMarker(playable: boolean): THREE.Group {
  const g = new THREE.Group();
  const colour = playable ? '#ffd23f' : '#ffffff';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.75, 2.05, 48),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: playable ? 0.9 : 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: playable ? 0.6 : 0.15, roughness: 0.3 }),
  );
  gem.position.y = 2.4;
  g.add(ring, gem);
  return g;
}
