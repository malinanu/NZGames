import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadGltf } from '../shared/assets';

/**
 * The six KayKit Adventurers, re-dressed as Kiwi holidaymakers: helmets, capes and quivers
 * come off, the armour and robe colours in each texture atlas are swapped for summer clothes,
 * and each gets a hat and a pair of jandals. All are adults (see docs/compliance.md).
 */
export interface CharacterDef {
  id: string;
  name: string;
  tagline: string;
  model: string;
  hide: string[];
  /** Replaces low-saturation (armour/metal/cloth) swatches. */
  shirt: string;
  /** Replaces strongly coloured swatches (capes, robes, trims). */
  trim: string;
  hat: 'santa' | 'sunhat' | 'bucket' | 'cap' | 'none';
  hatColour: string;
  jandals: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'kev', name: 'Kev', tagline: 'Backyard cricket legend', model: 'Knight', hide: ['Knight_Helmet', 'Knight_HelmetVisor', 'Knight_Cape'], shirt: '#2f6fd6', trim: '#ffd23f', hat: 'cap', hatColour: '#d7263d', jandals: '#1d2a6b' },
  { id: 'aroha', name: 'Aroha', tagline: 'Pav queen of the bach', model: 'Mage', hide: ['Mage_Hat', 'Mage_Cape'], shirt: '#e8578e', trim: '#2fb5a8', hat: 'sunhat', hatColour: '#f2d9a0', jandals: '#e8578e' },
  { id: 'tama', name: 'Tama', tagline: 'Surf club regular', model: 'Barbarian', hide: ['Barbarian_BearHat'], shirt: '#f2683c', trim: '#1fa3b5', hat: 'bucket', hatColour: '#1fa3b5', jandals: '#f2683c' },
  { id: 'mere', name: 'Mere', tagline: 'Trap line volunteer', model: 'Ranger', hide: ['Ranger_Cape', 'Ranger_Quiver'], shirt: '#3e8e4e', trim: '#f4a259', hat: 'bucket', hatColour: '#5b7f3a', jandals: '#3e8e4e' },
  { id: 'sam', name: 'Sam', tagline: 'Chief snag flipper', model: 'Rogue', hide: ['Rogue_Cape'], shirt: '#ffd23f', trim: '#d7263d', hat: 'santa', hatColour: '#d7263d', jandals: '#d7263d' },
  { id: 'jess', name: 'Jess', tagline: 'Champion jandal flicker', model: 'Rogue_Hooded', hide: ['RogueHooded_Cape', 'RogueHooded_Mask'], shirt: '#8b5cf6', trim: '#27c4f5', hat: 'none', hatColour: '#000000', jandals: '#27c4f5' },
];

export const HEIGHT = 1.75;

export type AnimName =
  | 'Idle_A' | 'Idle_B' | 'Walking_A' | 'Running_A' | 'Jump_Start' | 'Jump_Idle' | 'Jump_Land'
  | 'Interact' | 'PickUp' | 'Throw' | 'Use_Item' | 'Hit_A' | 'Cheering' | 'Waving'
  | 'Sit_Chair_Idle' | 'Sit_Floor_Idle' | 'Lie_Idle' | 'Push_Ups' | 'Fishing_Idle' | 'Digging'
  | 'Hammering' | 'Holding_A' | 'Melee_Unarmed_Idle' | 'Ranged_Magic_Raise' | 'Sneaking'
  | 'Walking_Backwards' | 'Skeletons_Taunt' | 'Crawling';

const ANIM_SETS = ['MovementBasic', 'General', 'Simulation', 'Tools', 'CombatMelee', 'CombatRanged', 'MovementAdvanced', 'Special'];
let clipsPromise: Promise<Map<string, THREE.AnimationClip>> | null = null;

/** All clips from the trimmed animation files, keyed by name. Loaded once. */
export function loadClips(): Promise<Map<string, THREE.AnimationClip>> {
  clipsPromise ??= Promise.all(ANIM_SETS.map((s) => loadGltf(`characters/anim_${s}.glb`))).then((files) => {
    const map = new Map<string, THREE.AnimationClip>();
    for (const f of files) for (const clip of f.animations) map.set(clip.name, clip);
    return map;
  });
  return clipsPromise;
}

const ONE_SHOT = new Set<AnimName>(['Jump_Start', 'Jump_Land', 'Interact', 'PickUp', 'Throw', 'Use_Item', 'Hit_A', 'Cheering', 'Waving']);

/** A posed, animated, Kiwi-fied character. */
export class Character {
  readonly root = new THREE.Group();
  /** Which of the cast this is (set by createCharacter). */
  def!: CharacterDef;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private oneShotEnd: (() => void) | null = null;

  constructor(model: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', () => {
      const end = this.oneShotEnd;
      this.oneShotEnd = null;
      end?.();
    });
  }

  get animation(): string {
    return this.currentName;
  }

  /** Crossfades to a looping or one-shot animation. One-shots call `then` when done. */
  play(name: AnimName, opts: { fade?: number; speed?: number; then?: () => void } = {}): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = opts.speed ?? 1;
    if (this.currentName === name && !ONE_SHOT.has(name)) return;
    const once = ONE_SHOT.has(name);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, opts.fade ?? 0.2, true);
    next.play();
    // Apply the pose now, not at the next tick: no T-pose frame for a fresh character.
    this.mixer.update(0);
    this.current = next;
    this.currentName = name;
    this.oneShotEnd = once ? (opts.then ?? null) : null;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

// ---------------------------------------------------------------------------
// Re-dressing
// ---------------------------------------------------------------------------

/** Recolours the gradient atlas: skin and hair stay, armour and cloth become summer clothes. */
function recolourAtlas(image: CanvasImageSource & { width: number; height: number }, def: CharacterDef): THREE.CanvasTexture {
  const size = 256; // The atlas is flat gradient swatches: 256 px loses nothing visible.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  const shirt = new THREE.Color(def.shirt);
  const trim = new THREE.Color(def.trim);
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new THREE.Color();
  for (let i = 0; i < px.length; i += 4) {
    c.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
    c.getHSL(hsl, THREE.SRGBColorSpace);
    const hue = hsl.h * 360;
    const skinOrHair = (hue < 50 || hue > 345) && hsl.s > 0.18 && hsl.l > 0.28;
    const leather = hue < 40 && hsl.s > 0.12 && hsl.l <= 0.28;
    if (skinOrHair || leather || hsl.l < 0.08 || hsl.l > 0.94) continue;
    const target = hsl.s < 0.18 ? shirt : trim;
    const t = { h: 0, s: 0, l: 0 };
    target.getHSL(t, THREE.SRGBColorSpace);
    // Keep the swatch's shading (its lightness gradient) but take the outfit's hue.
    const l = THREE.MathUtils.clamp(t.l + (hsl.l - 0.5) * 0.55, 0.08, 0.92);
    c.setHSL(t.h, t.s, l, THREE.SRGBColorSpace);
    const out = c.getStyle(THREE.SRGBColorSpace).match(/\d+/g)!.map(Number);
    px[i] = out[0];
    px[i + 1] = out[1];
    px[i + 2] = out[2];
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function mat(colour: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75 });
}

/**
 * Hats are solid lathed shapes sized from the wearer's head: `r` is the head's half-width.
 * The origin sits where the hat meets the head.
 */
function buildHat(kind: CharacterDef['hat'], colour: string, r: number): THREE.Object3D | null {
  const g = new THREE.Group();
  const lathe = (profile: [number, number][], col: string) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x * r, y * r)), 24), mat(col));
    (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    return m;
  };
  if (kind === 'bucket') {
    // Flat-topped crown flaring into a short, drooping brim with real thickness.
    g.add(lathe([[0, 0.62], [0.78, 0.62], [0.86, 0.56], [1.0, 0.02], [1.42, -0.2], [1.44, -0.26], [1.38, -0.27], [0.97, -0.06], [0.9, 0.0]], colour));
  } else if (kind === 'sunhat') {
    g.add(lathe([[0, 0.5], [0.72, 0.5], [0.84, 0.42], [0.96, 0.03], [1.95, -0.1], [1.98, -0.16], [1.9, -0.17], [0.94, -0.04]], colour));
    g.add(lathe([[0.9, 0.2], [0.985, 0.2], [0.995, 0.04], [0.97, 0.04]], '#e8578e'));
  } else if (kind === 'cap') {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(r * 1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(colour));
    crown.scale.y = 0.72;
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, r * 0.07, 20, 1, false, -Math.PI / 2, Math.PI), mat(colour));
    peak.position.set(0, r * 0.05, r * 0.62);
    peak.scale.z = 1.25;
    const button = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), mat(colour));
    button.position.y = r * 0.74;
    g.add(crown, peak, button);
  } else if (kind === 'santa') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.98, r * 1.7, 18), mat(colour));
    cone.position.y = r * 0.85;
    cone.rotation.z = -0.3;
    cone.position.x = r * 0.2;
    const fur = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.2, 8, 22), mat('#fbfbf6'));
    fur.rotation.x = Math.PI / 2;
    fur.position.y = r * 0.08;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 10, 8), mat('#fbfbf6'));
    pom.position.set(r * 0.78, r * 1.62, 0);
    g.add(cone, fur, pom);
  } else {
    return null;
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
  return g;
}

function buildJandal(colour: string): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.1, 0.19, 0, Math.PI * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat(colour));
  m.castShadow = true;
  return m;
}

const prepared = new Map<string, Promise<THREE.Object3D>>();

/** Builds (once per character) the re-dressed template; instances are skeleton-cloned from it. */
function prepare(def: CharacterDef): Promise<THREE.Object3D> {
  let p = prepared.get(def.id);
  if (!p) {
    p = loadGltf(`characters/${def.model}.glb`).then((gltf) => {
      const model = SkeletonUtils.clone(gltf.scene);
      let atlas: THREE.CanvasTexture | null = null;
      model.traverse((o) => {
        if (def.hide.includes(o.name)) o.visible = false;
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const source = mesh.material as THREE.MeshStandardMaterial;
        if (source.map?.image) {
          atlas ??= recolourAtlas(source.map.image as HTMLImageElement, def);
          const m = source.clone();
          m.map = atlas;
          mesh.material = m;
        }
      });
      // Real-world height, standing on y = 0.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const scale = HEIGHT / (box.max.y - box.min.y);
      model.scale.setScalar(scale);
      model.position.y = -box.min.y * scale;
      model.updateMatrixWorld(true);

      // Hat on the head bone, sitting on top of the head mesh.
      const headBone = model.getObjectByName('head');
      const headMesh = model.getObjectByName(`${def.model.replace('_', '')}_Head`) ?? model.getObjectByName(`${def.model}_Head`);
      // Size and seat the hat from the head mesh itself, so it fits every character.
      const headBox = new THREE.Box3().setFromObject(headMesh ?? headBone ?? model);
      const headR = Math.max(headBox.max.x - headBox.min.x, headBox.max.z - headBox.min.z) / 2;
      const hat = buildHat(def.hat, def.hatColour, headR);
      if (headBone && hat) {
        const headH = headBox.max.y - headBox.min.y;
        const world = new THREE.Vector3((headBox.min.x + headBox.max.x) / 2, headBox.max.y - headH * 0.3, (headBox.min.z + headBox.max.z) / 2);
        headBone.worldToLocal(world);
        hat.position.copy(world);
        // Bones carry the model scale; undo it so the hat keeps its metre size.
        hat.scale.setScalar(1 / headBone.getWorldScale(new THREE.Vector3()).x);
        // Keep the hat upright regardless of how the bone is oriented in bind pose.
        hat.quaternion.copy(headBone.getWorldQuaternion(new THREE.Quaternion()).invert());
        headBone.add(hat);
      }
      for (const side of ['l', 'r']) {
        const foot = model.getObjectByName(`foot.${side}`);
        if (!foot) continue;
        const j = buildJandal(def.jandals);
        const s = foot.getWorldScale(new THREE.Vector3()).x;
        j.scale.setScalar(1 / s);
        const footPos = foot.getWorldPosition(new THREE.Vector3());
        const sole = new THREE.Vector3(footPos.x, 0.005, footPos.z + 0.05);
        foot.worldToLocal(sole);
        j.position.copy(sole);
        j.quaternion.copy(foot.getWorldQuaternion(new THREE.Quaternion()).invert());
        foot.add(j);
      }
      return model;
    });
    prepared.set(def.id, p);
  }
  return p;
}

export async function createCharacter(def: CharacterDef): Promise<Character> {
  const [template, clips] = await Promise.all([prepare(def), loadClips()]);
  const model = SkeletonUtils.clone(template);
  // Skinned bounds are computed once from the pose, not per frame, so pad them generously
  // (arms out, sitting, jumping) and let the camera cull characters that are out of view.
  // Without this every NPC in the world was drawn twice a frame (main and shadow pass).
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.computeBoundingSphere();
    mesh.boundingSphere!.radius *= 1.8;
  });
  const c = new Character(model, clips);
  c.root.name = `character:${def.id}`;
  c.def = def;
  c.play('Idle_A');
  return c;
}
