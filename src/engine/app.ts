import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { quality } from './quality';

export type UpdateFn = (dt: number, elapsed: number) => void;
export type ResizeFn = () => void;

/**
 * Owns the renderer, the single scene and the frame loop. Everything else (world, zones,
 * UI) registers update callbacks.
 *
 * Rendering uses three.js's WebGPURenderer. It runs on WebGPU where the browser has it and
 * falls back to WebGL 2 automatically (most iPhones today); `?renderer=webgl` forces the
 * fallback. All custom shaders are TSL node materials so the same code works on both.
 */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.2, 900);
  private readonly updates = new Set<UpdateFn>();
  private readonly resizers = new Set<ResizeFn>();
  private readonly timer = new THREE.Timer();
  private elapsed = 0;
  private maxPixelRatio = Math.min(window.devicePixelRatio, quality.preset.maxPixelRatio);
  private pixelRatio = this.maxPixelRatio;
  private slowTime = 0;
  private fastTime = 0;
  private resizeTimer = 0;
  /** Smoothed frames per second, for the quality scaler and debugging. */
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
    this.renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', forceWebGL });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Which GPU API is actually drawing: 'WebGPU' or 'WebGL'. Valid after init(). */
  get backend(): string {
    const b = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return b?.isWebGPUBackend ? 'WebGPU' : 'WebGL';
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  onUpdate(fn: UpdateFn): () => void {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  /** Called once the user has stopped resizing (expensive rebuilds go here, not in resize). */
  onResizeSettled(fn: ResizeFn): () => void {
    this.resizers.add(fn);
    return () => this.resizers.delete(fn);
  }

  /** A small JPEG of the current view. Renders a fresh frame first so the canvas has content. */
  async snapshot(width = 320): Promise<string> {
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

  /** The cheap part of resizing happens at once; the expensive part waits until it settles. */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Vertical FOV: a little wider on portrait screens. Distance is handled by the camera rig.
    this.camera.fov = w < h ? 60 : 50;
    this.camera.updateProjectionMatrix();
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.resizers.forEach((fn) => fn()), 200);
  }

  start(): void {
    // A connected Timer resets on tab visibility; update() without the loop timestamp avoids
    // r187's negative delta after a hidden tab returns, and the clamp bounds stalls.
    this.timer.connect(document);
    this.renderer.setAnimationLoop(() => {
      this.timer.update();
      const dt = Math.min(Math.max(this.timer.getDelta(), 0), 0.05);
      this.elapsed += dt;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this.adaptQuality(dt);
      for (const fn of this.updates) fn(dt, this.elapsed);
      this.renderer.render(this.scene, this.camera);
    });
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
