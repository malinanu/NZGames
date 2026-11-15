import * as THREE from 'three';

/**
 * Two modes:
 *  - follow: third-person behind the player, yaw turned by drag/keys, eased.
 *  - shot: a fixed position and look target set by a zone (eased in from wherever it was).
 */
export class CameraRig {
  yaw = 0;
  distance = 7.5;
  height = 4.2;
  private mode: 'follow' | 'shot' = 'follow';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly goalPos = new THREE.Vector3();
  private readonly goalLook = new THREE.Vector3();
  private sharpness = 6;
  private snapNext = true;
  /** Set by the world: true where the camera would be inside a building. */
  obstructed: ((x: number, z: number) => boolean) | null = null;
  private pull = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  follow(): void {
    this.mode = 'follow';
    this.sharpness = 3.5;
  }

  /** Move to a fixed shot. `sharpness` controls how quickly it eases (higher = faster). */
  shot(position: THREE.Vector3, target: THREE.Vector3, sharpness = 3.2): void {
    this.mode = 'shot';
    this.goalPos.copy(position);
    this.goalLook.copy(target);
    this.sharpness = sharpness;
  }

  snap(): void {
    this.snapNext = true;
  }

  get isFollowing(): boolean {
    return this.mode === 'follow';
  }

  update(dt: number, subject: THREE.Vector3): void {
    if (this.mode === 'follow') {
      const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      // Slide the camera in towards the player rather than letting it sit inside a building.
      let clear = 1;
      if (this.obstructed) {
        for (let i = 1; i <= 8; i++) {
          const t = i / 8;
          if (this.obstructed(subject.x + back.x * this.distance * t, subject.z + back.z * this.distance * t)) {
            clear = Math.max(0.22, (i - 1) / 8);
            break;
          }
        }
      }
      this.pull += (clear - this.pull) * Math.min(1, dt * (clear < this.pull ? 14 : 3));
      this.goalPos.copy(subject).addScaledVector(back, this.distance * this.pull).setY(subject.y + this.height * (0.55 + 0.45 * this.pull));
      this.goalLook.copy(subject).setY(subject.y + 1.3);
      // Ease back to normal follow speed after a shot hands over.
      this.sharpness += (6 - this.sharpness) * Math.min(1, dt * 1.5);
    }
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * this.sharpness);
    this.snapNext = false;
    this.pos.lerp(this.goalPos, k);
    this.look.lerp(this.goalLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
