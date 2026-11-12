export type Levels = {
  level: number;
  bass: number;
  mid: number;
  treble: number;
};

export const ZERO_LEVELS: Levels = { level: 0, bass: 0, mid: 0, treble: 0 };

export class AudioEngine {
  demo = false;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private source: AudioBufferSourceNode | null = null;
  private levels: Levels = { ...ZERO_LEVELS };

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  async ensure(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio no está disponible en este dispositivo.");
      this.ctx = new Ctor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.72;
      this.analyser.connect(this.ctx.destination);
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get isSpeaking(): boolean {
    return this.source !== null;
  }

  async play(bytes: Uint8Array, _mimeType?: string): Promise<void> {
    await this.ensure();
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) throw new Error("Audio no inicializado.");

    this.stop();

    const copy = bytes.slice();
    const buffer = await ctx.decodeAudioData(copy.buffer);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);

    await new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.source === source) this.source = null;
        resolve();
      };
      this.source = source;
      source.start();
    });
  }

  stop(): void {
    if (!this.source) return;
    const current = this.source;
    this.source = null;
    try {
      current.stop();
    } catch {
      /* already stopped */
    }
  }

  getLevels(): Levels {
    if (this.demo) {
      const t = performance.now() / 1000;
      const level = Math.max(0, Math.min(0.68, 0.4 + 0.18 * Math.sin(t * 5.2) + 0.08 * Math.sin(t * 15.7)));
      return {
        level,
        bass: Math.max(0, Math.min(0.7, 0.38 + 0.26 * Math.sin(t * 3.1))),
        mid: Math.max(0, Math.min(0.7, 0.34 + 0.24 * Math.sin(t * 7.3 + 1.2))),
        treble: Math.max(0, Math.min(0.65, 0.26 + 0.28 * Math.sin(t * 11.0 + 2.4))),
      };
    }

    const analyser = this.analyser;
    const spectrum = this.spectrum;
    if (!analyser || !spectrum || !this.source) {
      this.decay();
      return this.levels;
    }

    analyser.getByteFrequencyData(spectrum);
    const n = spectrum.length;
    const band = (from: number, to: number): number => {
      const start = Math.floor(n * from);
      const end = Math.max(start + 1, Math.floor(n * to));
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += spectrum[i];
      return sum / (end - start) / 255;
    };

    const bass = Math.pow(band(0.0, 0.09), 1.15);
    const mid = Math.pow(band(0.09, 0.36), 1.2);
    const treble = Math.pow(band(0.36, 0.82), 1.35);
    const level = Math.min(1, bass * 0.5 + mid * 0.85 + treble * 0.35);

    this.levels = {
      level: this.lerp(this.levels.level, level, level > this.levels.level ? 0.5 : 0.14),
      bass: this.lerp(this.levels.bass, bass, bass > this.levels.bass ? 0.55 : 0.16),
      mid: this.lerp(this.levels.mid, mid, mid > this.levels.mid ? 0.5 : 0.15),
      treble: this.lerp(this.levels.treble, treble, treble > this.levels.treble ? 0.5 : 0.18),
    };
    return this.levels;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.analyser = null;
      this.spectrum = null;
    }
  }

  private decay(): void {
    this.levels = {
      level: this.lerp(this.levels.level, 0, 0.12),
      bass: this.lerp(this.levels.bass, 0, 0.12),
      mid: this.lerp(this.levels.mid, 0, 0.12),
      treble: this.lerp(this.levels.treble, 0, 0.12),
    };
  }

  private lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
  }
}
