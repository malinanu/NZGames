import type { Biome } from './terrain';

/**
 * Ambient sound made entirely with Web Audio (no audio files): surf, birdsong, cicadas and
 * footsteps, mixed by where the player is. Starts on the first tap, as browsers require.
 */
const STORE = 'kiwi-christmas:muted';

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private surf: GainNode | null = null;
  private cicadas: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextChirp = 0;
  private birdLevel = 0.5;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORE) === '1';
    } catch {
      // Storage blocked: sound just defaults to on.
    }
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      this.start();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private start(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    const loop = () => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.start();
      return src;
    };

    // Surf: low-passed noise that swells every few seconds.
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 650;
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(swell.gain);
    lfo.start();
    this.surf = ctx.createGain();
    this.surf.gain.value = 0;
    loop().connect(surfFilter).connect(swell).connect(this.surf).connect(this.master);

    // Cicadas: a narrow band of high noise, pulsed.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 5200;
    band.Q.value = 9;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const rattle = ctx.createOscillator();
    rattle.type = 'square';
    rattle.frequency.value = 38;
    const rattleDepth = ctx.createGain();
    rattleDepth.gain.value = 0.5;
    rattle.connect(rattleDepth).connect(pulse.gain);
    rattle.start();
    this.cicadas = ctx.createGain();
    this.cicadas.gain.value = 0;
    loop().connect(band).connect(pulse).connect(this.cicadas).connect(this.master);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORE, muted ? '1' : '0');
    } catch {
      // Not remembered, that's all.
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.1);
  }

  /** Call every frame with where the player is. `shore` is metres to the waterline. */
  update(biome: Biome, shore: number, night: number): void {
    const { ctx } = this;
    if (!ctx || !this.surf || !this.cicadas) return;
    const t = ctx.currentTime;
    this.surf.gain.setTargetAtTime(Math.max(0.02, 0.5 * Math.exp(-Math.max(0, shore) / 45)), t, 0.6);
    this.cicadas.gain.setTargetAtTime((biome === 'town' || biome === 'farm' ? 0.05 : biome === 'bush' ? 0.03 : 0.01) * (1 - night), t, 0.8);
    this.birdLevel = (biome === 'bush' ? 1 : biome === 'farm' || biome === 'town' ? 0.5 : 0.2) * (1 - night * 0.9);
    if (t > this.nextChirp) {
      this.nextChirp = t + 0.4 + Math.random() * (3.2 - this.birdLevel * 2.2);
      if (Math.random() < this.birdLevel) this.chirp();
    }
  }

  private chirp(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const notes = 1 + Math.floor(Math.random() * 4);
    const base = 1800 + Math.random() * 2400;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(master);
    for (let i = 0; i < notes; i++) {
      const at = ctx.currentTime + i * (0.09 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (1 + i * 0.08), at);
      osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), at + 0.07);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.07 * this.birdLevel, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.11);
      osc.connect(gain).connect(pan);
      osc.start(at);
      osc.stop(at + 0.13);
    }
  }

  /** A soft step. Sand and grass are duller than the road or the jetty. */
  step(surface: 'grass' | 'sand' | 'hard'): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = surface === 'hard' ? 2200 : surface === 'sand' ? 500 : 900;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(surface === 'hard' ? 0.1 : 0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (surface === 'sand' ? 0.12 : 0.06));
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random());
    src.stop(t + 0.15);
  }

  /** A little rising chime for finding something. */
  chime(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    [880, 1175, 1568].forEach((f, i) => {
      const at = ctx.currentTime + i * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  }
}
