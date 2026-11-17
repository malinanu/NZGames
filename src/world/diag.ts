import * as THREE from 'three';
import type { App } from '../engine/app';
import { quality } from '../engine/quality';
import { world as gpu, installFog } from '../engine/tsl';

/**
 * `?diag`: a small panel for diagnosing rendering problems on someone else's device. It shows
 * the renderer, quality, screen, day/night state and fog, and what is under the screen centre
 * (mesh kind, material, texture), with toggles for fog, shadows and tone mapping. One
 * screenshot of it says which part of the pipeline is responsible.
 */
export function installDiag(app: App, sun: THREE.DirectionalLight, player: () => THREE.Vector3 | null, phase: () => string): void {
  const el = document.createElement('div');
  el.className = 'diag';
  el.innerHTML = `
    <pre data-out></pre>
    <div class="diag-row">
      <button data-t="fog">Fog on</button><button data-t="shadow">Shadows on</button><button data-t="tone">Tone map on</button>
    </div>`;
  document.body.appendChild(el);
  const out = el.querySelector<HTMLElement>('[data-out]')!;
  const state = { fog: true, shadow: true, tone: true };
  const toneMapping = app.renderer.toneMapping;
  el.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.t as keyof typeof state;
      state[k] = !state[k];
      b.textContent = `${{ fog: 'Fog', shadow: 'Shadows', tone: 'Tone map' }[k]} ${state[k] ? 'on' : 'off'}`;
      if (k === 'fog') {
        if (state.fog) installFog(app.scene);
        else (app.scene as unknown as { fogNode: unknown }).fogNode = null;
      }
      if (k === 'shadow') sun.castShadow = state.shadow;
      if (k === 'tone') app.renderer.toneMapping = state.tone ? toneMapping : THREE.NoToneMapping;
    }),
  );

  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  const describe = (): string => {
    ray.setFromCamera(centre, app.camera);
    const hit = ray.intersectObjects(app.scene.children, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
    if (!hit) return 'centre: (nothing)';
    const o = hit.object as THREE.Mesh;
    const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    const kind = (o as THREE.InstancedMesh).isInstancedMesh ? 'instanced' : (o as THREE.SkinnedMesh).isSkinnedMesh ? 'skinned' : o.name.startsWith('batch') ? 'batch' : 'mesh';
    const img = m.map?.image as { width?: number; height?: number } | undefined;
    let top: THREE.Object3D = o;
    while (top.parent && top.parent.type !== 'Scene') top = top.parent;
    return [
      `centre: ${kind} "${o.name || top.name || '?'}" at ${hit.distance.toFixed(1)} m`,
      `  material ${m.type} colour #${m.color?.getHexString() ?? '-'} rough ${m.roughness ?? '-'} metal ${m.metalness ?? '-'} fog ${m.fog}`,
      `  map ${m.map ? `${img?.width}x${img?.height} ${m.map.colorSpace}` : 'none'} vertexColors ${m.vertexColors}`,
    ].join('\n');
  };

  let t = 0;
  app.onUpdate((dt) => {
    t -= dt;
    if (t > 0) return;
    t = 0.5;
    const p = player();
    const f = gpu.focal.value as THREE.Vector3;
    out.textContent = [
      `renderer ${app.backend} · quality ${quality.preset.name} · dpr ${window.devicePixelRatio} · canvas ${app.canvas.width}x${app.canvas.height}`,
      `fps ${Math.round(app.fps)} · draw calls ${(() => { const r = app.renderer.info.render as { drawCalls?: number; calls?: number }; return Math.max(r.drawCalls ?? 0, r.calls ?? 0); })()}`,
      `cycle ${phase()} · fog ${(gpu.fogNear.value as number).toFixed(0)}-${(gpu.fogFar.value as number).toFixed(0)} m #${(gpu.fogColor.value as THREE.Color).getHexString()} · light ${(gpu.light.value as number).toFixed(2)} · night ${(gpu.night.value as number).toFixed(2)}`,
      `focal ${f.x.toFixed(1)}, ${f.z.toFixed(1)} · player ${p ? `${p.x.toFixed(1)}, ${p.z.toFixed(1)}` : '-'}`,
      describe(),
    ].join('\n');
  });
}
