import * as THREE from 'three';

/**
 * Walking input: a floating thumb-stick on touch screens (appears wherever the left thumb
 * lands), WASD/arrows on keyboards. Dragging on the right side of the screen turns the camera.
 * Zones switch this off and handle their own pointer input on the canvas.
 */
export class Input {
  /** x = strafe right, y = forward. Length 0..1. */
  readonly move = new THREE.Vector2();
  /** Camera turn requested since the last read, in radians. */
  private turn = 0;
  run = false;
  private jumpQueued = false;
  private interactQueued = false;
  private enabledFlag = true;

  private readonly keys = new Set<string>();
  private stickPointer: number | null = null;
  private turnPointer: number | null = null;
  private readonly stickOrigin = new THREE.Vector2();
  private readonly stickVec = new THREE.Vector2();
  private lastTurnX = 0;
  private readonly stickEl: HTMLElement;
  private readonly knobEl: HTMLElement;
  private readonly radius = 56;

  constructor(private readonly surface: HTMLElement) {
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.stickEl.setAttribute('aria-hidden', 'true');
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'stick-knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);

    window.addEventListener('keydown', (e) => {
      if (!this.enabledFlag || e.repeat) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.interactQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.moveTo(e));
    surface.addEventListener('pointerup', (e) => this.up(e));
    surface.addEventListener('pointercancel', (e) => this.up(e));
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  set enabled(v: boolean) {
    this.enabledFlag = v;
    if (!v) {
      this.keys.clear();
      this.stickPointer = null;
      this.turnPointer = null;
      this.stickVec.set(0, 0);
      this.stickEl.classList.remove('on');
      this.move.set(0, 0);
    }
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  consumeInteract(): boolean {
    const j = this.interactQueued;
    this.interactQueued = false;
    return j;
  }

  queueInteract(): void {
    this.interactQueued = true;
  }

  consumeTurn(): number {
    let t = this.turn;
    this.turn = 0;
    if (this.keys.has('KeyQ')) t += 0.035;
    if (this.keys.has('KeyR')) t -= 0.035;
    return t;
  }

  /** Call once per frame before reading `move`. */
  update(): void {
    if (!this.enabledFlag) return;
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const keyboard = x !== 0 || y !== 0;
    if (keyboard) {
      this.move.set(x, y).normalize();
      this.run = !(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    } else {
      this.move.copy(this.stickVec);
      this.run = this.move.length() > 0.72;
    }
  }

  private down(e: PointerEvent): void {
    if (!this.enabledFlag) return;
    const leftSide = e.clientX < window.innerWidth * 0.5;
    if (leftSide && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin.set(e.clientX, e.clientY);
      this.stickVec.set(0, 0);
      this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knobEl.style.transform = 'translate(-50%, -50%)';
      this.stickEl.classList.add('on');
    } else if (!leftSide && this.turnPointer === null) {
      this.turnPointer = e.pointerId;
      this.lastTurnX = e.clientX;
    } else return;
    this.surface.setPointerCapture?.(e.pointerId);
  }

  private moveTo(e: PointerEvent): void {
    if (e.pointerId === this.stickPointer) {
      const d = new THREE.Vector2(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y);
      const len = Math.min(d.length(), this.radius);
      d.setLength(len);
      this.knobEl.style.transform = `translate(calc(-50% + ${d.x}px), calc(-50% + ${d.y}px))`;
      // A small dead zone stops drift when a thumb is just resting.
      const n = len / this.radius;
      this.stickVec.set(d.x, -d.y).setLength(n < 0.12 ? 0 : (n - 0.12) / 0.88);
    } else if (e.pointerId === this.turnPointer) {
      this.turn -= (e.clientX - this.lastTurnX) * 0.0085;
      this.lastTurnX = e.clientX;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stickVec.set(0, 0);
      this.stickEl.classList.remove('on');
    } else if (e.pointerId === this.turnPointer) {
      this.turnPointer = null;
    }
  }
}
