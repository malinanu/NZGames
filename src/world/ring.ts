import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, dot, float, mix, smoothstep, uniform, uv } from 'three/tsl';

/** Radius of the outer ring in metres: drag past it and you run. */
export const RING_RADIUS = 1.6;
const PAD = 1.15;

/**
 * The touch joystick, drawn on the ground around the player as signed-distance rings: a small
 * inner circle (tap it to jump), an outer ring, and a wedge pointing where you're pushing that
 * grows with how hard you push. Turns yellow when you're running.
 */
export function groundRing() {
  const dir = uniform(new THREE.Vector2(0, 1));
  const amount = uniform(0);
  const show = uniform(0);
  const running = uniform(0);

  const geo = new THREE.PlaneGeometry(RING_RADIUS * 2 * PAD, RING_RADIUS * 2 * PAD).rotateX(-Math.PI / 2);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const p = uv().sub(0.5).mul(2 * PAD); // 1 at the outer ring
  const r = p.length();
  const band = (at: number, w: number) => smoothstep(float(at - w * 1.6), float(at - w * 0.4), r).mul(float(1).sub(smoothstep(float(at + w * 0.4), float(at + w * 1.6), r)));
  const outer = band(1, 0.035);
  const inner = band(0.3, 0.03);
  const facing = smoothstep(float(0.86), float(0.97), dot(p.div(r.max(1e-3)), dir));
  const reach = float(0.3).add(amount.mul(0.7));
  const wedge = facing.mul(smoothstep(float(0.3), float(0.34), r)).mul(float(1).sub(smoothstep(reach.sub(0.04), reach, r)));
  const tint = mix(color('#ffffff'), color('#ffd23f'), running);
  m.colorNode = tint;
  m.opacityNode = outer.mul(0.55).add(inner.mul(0.7)).add(wedge.mul(0.4)).min(1).mul(show);

  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  mesh.visible = false;
  let fade = 0;
  const v = new THREE.Vector2();
  return {
    object: mesh,
    /**
     * `push` is the world-space walk direction (x, z) and strength (0..1); `on` while a finger
     * is down. Call every frame with the player's feet position.
     */
    update(dt: number, at: THREE.Vector3, on: boolean, push: { x: number; z: number; amount: number; run: boolean }) {
      fade += ((on ? 1 : 0) - fade) * Math.min(1, dt * 10);
      mesh.visible = fade > 0.01;
      if (!mesh.visible) return;
      mesh.position.set(at.x, at.y + 0.06, at.z);
      show.value = fade;
      amount.value += (push.amount - amount.value) * Math.min(1, dt * 14);
      running.value += ((push.run ? 1 : 0) - running.value) * Math.min(1, dt * 8);
      // Plane uv y runs towards -z once laid flat.
      if (push.amount > 0) dir.value.copy(v.set(push.x, -push.z).normalize());
    },
  };
}
