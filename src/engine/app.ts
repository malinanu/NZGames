import * as THREE from 'three';

export type UpdateFn = (dt: number, elapsed: number) => void;

/**
 * Owns the renderer, the single scene and the frame loop. Everything else (world, zones,
 * UI) registers update callbacks. Rendering quality adapts to the device: if frames run
 * slow for a couple of seconds the pixel ratio steps down.
 */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.2, 900);
  private readonly updates = new Set<UpdateFn>();
  /** Runs once, straight after the next frame is drawn (used to grab a snapshot). */
  private afterRender: (() => void)[] = [];
  private readonly clock = new THREE.Clock();
  private elapsed = 0;
  private maxPixelRatio = Math.min(window.devicePixelRatio, 2);
  private pixelRatio = this.maxPixelRatio;
  private slowTime = 0;
  private fastTime = 0;
  /** Smoothed frames per second, for the quality scaler and debugging. */
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onUpdate(fn: UpdateFn): () => void {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  /** A small JPEG of what is on screen right now. Must be read straight after a render. */
  snapshot(width = 320): string {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round(width * 0.66);
    // Centre-crop to a postcard shape.
    const srcH = Math.min(src.height, src.width * 0.66);
    const srcW = srcH / 0.66;
    out.getContext('2d')!.drawImage(src, (src.width - srcW) / 2, (src.height - srcH) * 0.4, srcW, srcH, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.72);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Wider vertical field of view on portrait phones so the world doesn't feel cramped.
    this.camera.fov = w < h ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    const frame = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.elapsed += dt;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this.adaptQuality(dt);
      for (const fn of this.updates) fn(dt, this.elapsed);
      this.renderer.render(this.scene, this.camera);
      if (this.afterRender.length) {
        for (const fn of this.afterRender.splice(0)) fn();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private adaptQuality(dt: number): void {
    if (this.fps < 42) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (this.fps > 57) {
      this.fastTime += dt;
      this.slowTime = 0;
    }
    if (this.slowTime > 2 && this.pixelRatio > 1) {
      this.setPixelRatio(Math.max(1, this.pixelRatio - 0.25));
      this.slowTime = 0;
    } else if (this.fastTime > 6 && this.pixelRatio < this.maxPixelRatio) {
      this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.25));
      this.fastTime = 0;
    }
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }
}
