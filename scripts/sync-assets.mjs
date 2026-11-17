// Copies the models listed in scripts/models.json from assets-src/kaykit into
// public/models (flattened per pack), together with the textures they reference.
// Only what a game actually loads is shipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src/kaykit');
const out = path.join(root, 'public/models');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/models.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
let count = 0;
let bytes = 0;

const images = [];
function copy(from, to) {
  if (fs.existsSync(to)) return;
  fs.copyFileSync(from, to);
  if (/\.(png|jpe?g)$/i.test(to)) images.push(to);
  bytes += fs.statSync(to).size;
}

/**
 * Pack atlases are 1024 px gradient strips; 512 px looks the same on a phone and needs a
 * quarter of the GPU memory (about 4 MB less per atlas once mipmapped).
 */
const ATLAS = 512;
async function shrinkImages() {
  for (const file of images) {
    const img = sharp(fs.readFileSync(file));
    const meta = await img.metadata();
    if ((meta.width ?? 0) <= ATLAS) continue;
    const buf = await img.resize(ATLAS, ATLAS, { fit: 'fill', kernel: 'nearest' }).png({ compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(file, buf);
  }
}

for (const [pack, models] of Object.entries(manifest)) {
  const dst = path.join(out, pack);
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of models) {
    const gltfPath = path.join(src, pack, `${rel}.gltf`);
    if (!fs.existsSync(gltfPath)) throw new Error(`Missing model: ${pack}/${rel}`);
    const dir = path.dirname(gltfPath);
    const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
    const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].map((x) => x.uri).filter(Boolean);
    for (const uri of uris) {
      if (uri.startsWith('data:')) continue;
      if (uri.includes('/') || uri.includes('\\')) throw new Error(`Unexpected nested uri in ${rel}: ${uri}`);
      copy(path.join(dir, decodeURIComponent(uri)), path.join(dst, decodeURIComponent(uri)));
    }
    copy(gltfPath, path.join(dst, path.basename(gltfPath)));
    count++;
  }
}
await shrinkImages();
console.log(`[assets] ${count} models -> public/models (${(bytes / 1024).toFixed(0)} KB)`);
