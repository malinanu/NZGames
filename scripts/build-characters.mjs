// Ships the Adventurer characters and a trimmed animation set.
// The KayKit animation GLBs each carry a full mannequin mesh and every clip in the set;
// the game only needs some clips and no mesh, so each set is pruned down to its clips.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample, quantize } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src/kaykit');
const out = path.join(root, 'public/models/characters');
fs.mkdirSync(out, { recursive: true });

export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];
export const CLIPS = {
  MovementBasic: ['Walking_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land'],
  General: ['Idle_A', 'Idle_B', 'Interact', 'PickUp', 'Throw', 'Use_Item', 'Hit_A'],
  Simulation: ['Cheering', 'Waving', 'Sit_Chair_Idle', 'Sit_Floor_Idle', 'Lie_Idle', 'Push_Ups'],
  Tools: ['Fishing_Idle', 'Digging', 'Hammering', 'Holding_A'],
  CombatMelee: ['Melee_Unarmed_Idle'],
  CombatRanged: ['Ranged_Magic_Raise'],
  MovementAdvanced: ['Sneaking', 'Walking_Backwards', 'Crawling'],
  Special: ['Skeletons_Taunt'],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const quiet = { debug() {}, info() {}, warn: console.warn, error: console.error };

let bytes = 0;
for (const name of CHARACTERS) {
  const from = path.join(src, 'characters', `${name}.glb`);
  const to = path.join(out, `${name}.glb`);
  // Quantised vertex data (KHR_mesh_quantization, decoded by three with no extra code):
  // roughly half the download. Characters are never baked into batches, so normalised
  // integer positions are safe here.
  const doc = await io.read(from);
  doc.setLogger(quiet);
  await doc.transform(dedup(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), prune());
  await io.write(to, doc);
  bytes += fs.statSync(to).size;
}
for (const [set, keep] of Object.entries(CLIPS)) {
  const doc = await io.read(path.join(src, 'animations', `Rig_Medium_${set}.glb`));
  doc.setLogger(quiet);
  const r = doc.getRoot();
  const have = new Set(r.listAnimations().map((a) => a.getName()));
  for (const want of keep) if (!have.has(want)) throw new Error(`Missing clip ${set}/${want}`);
  for (const anim of r.listAnimations()) {
    if (keep.includes(anim.getName())) continue;
    // Samplers can share keyframe accessors with kept clips; prune() drops the orphans.
    for (const sampler of anim.listSamplers()) sampler.dispose();
    for (const channel of anim.listChannels()) channel.dispose();
    anim.dispose();
  }
  // Drop the mannequin: animations target bones by name, so no mesh or skin is needed.
  for (const node of r.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const m of r.listMeshes()) m.dispose();
  for (const s of r.listSkins()) s.dispose();
  await doc.transform(resample(), dedup(), prune({ keepLeaves: true }));
  const to = path.join(out, `anim_${set}.glb`);
  await io.write(to, doc);
  bytes += fs.statSync(to).size;
}
console.log(`[characters] ${CHARACTERS.length} characters + ${Object.values(CLIPS).flat().length} clips (${(bytes / 1024).toFixed(0)} KB)`);
