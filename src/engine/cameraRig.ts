import * as THREE from 'three';

/** The screen zone shots were framed on: a 420x800 portrait phone, 60° vertical FOV. */
const REF_ASPECT = 420 / 800;
const REF_FOV = 60;

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
  private readonly shotFrom = new THREE.Vector3();
  private shotFit = false;
  private snapNext = true;
  /** Set by the world: true where the camera would be inside a building. */
  obstructed: ((x: number, z: number) => boolean) | null = null;
  private pull = 1;
  /** Player zoom (pinch, wheel, shoulder buttons), 0.6 (close) to 1.7 (far). */
  zoom = 1;
  /** Fixed scale: quality preset times the screen-shape overflow (see `fitScreen`). */
  scale = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  zoomBy(amount: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(amount), 0.6, 1.7);
  }

  /**
   * Ratio overflow: the follow framing is designed for 16:9. Narrower screens see less to the
   * sides, so the camera pulls back a little in proportion to how far the aspect falls short.
   */
  fitScreen(aspect: number, preset = 1): void {
    const overflow = Math.max(0, 16 / 9 / aspect - 1);
    // Portrait already gets a wider vertical FOV (App.resize), so the pull-back stays gentle:
    // about 6% on a 9:19.5 phone.
    this.scale = preset * (1 + overflow * 0.025);
  }

  follow(): void {
    this.mode = 'follow';
    this.sharpness = 3.5;
  }

  /**
   * Move to a fixed shot. `sharpness` controls how quickly it eases (higher = faster).
   * With `fit`, the shot is treated as framed for a 420x800 portrait phone and pulled back
   * along (position - target) on screens that would otherwise crop it (see `shotScale`).
   * It is re-applied every frame, so turning the phone mid-game keeps the framing.
   */
  shot(position: THREE.Vector3, target: THREE.Vector3, sharpness = 3.2, fit = false): void {
    this.mode = 'shot';
    this.shotFrom.copy(position);
    this.shotFit = fit;
    this.goalLook.copy(target);
    this.sharpness = sharpness;
  }

  /**
   * Ratio overflow for zone shots, which were tuned on a 420x800 portrait phone (60° vertical
   * FOV, see App.resize). A narrower phone sees less to the sides, so the camera backs off until
   * the tuned width fits again. Landscape screens already see far more to the sides but get a
   * 50° vertical FOV, so they back off a little for the height. The result is softened so it
   * stays gentle: 1 on the tuned phone and on wider portrait screens, about 1.1 on a 9:19.5
   * phone and on 16:9 landscape.
   */
  shotScale(): number {
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const refV = Math.tan(THREE.MathUtils.degToRad(REF_FOV / 2));
    const refH = refV * REF_ASPECT;
    const need = Math.max(1, refH / tanH, 1 + (refV / tanV - 1) * 0.5);
    return Math.min(1.4, 1 + (need - 1) * 0.8);
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
      const dist = this.distance * this.zoom * this.scale;
      const height = this.height * this.zoom * this.scale;
      // Slide the camera in towards the player rather than letting it sit inside a building.
      let clear = 1;
      if (this.obstructed) {
        for (let i = 1; i <= 8; i++) {
          const t = i / 8;
          if (this.obstructed(subject.x + back.x * dist * t, subject.z + back.z * dist * t)) {
            clear = Math.max(0.22, (i - 1) / 8);
            break;
          }
        }
      }
      this.pull += (clear - this.pull) * Math.min(1, dt * (clear < this.pull ? 14 : 3));
      this.goalPos.copy(subject).addScaledVector(back, dist * this.pull).setY(subject.y + height * (0.55 + 0.45 * this.pull));
      this.goalLook.copy(subject).setY(subject.y + 1.3);
      // Ease back to normal follow speed after a shot hands over.
      this.sharpness += (6 - this.sharpness) * Math.min(1, dt * 1.5);
    } else {
      const k = this.shotFit ? this.shotScale() : 1;
      this.goalPos.copy(this.shotFrom).sub(this.goalLook).multiplyScalar(k).add(this.goalLook);
    }
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * this.sharpness);
    this.snapNext = false;
    this.pos.lerp(this.goalPos, k);
    this.look.lerp(this.goalLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
