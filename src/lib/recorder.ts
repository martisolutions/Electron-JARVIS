export type RecorderLevels = {
  level: number;
  bass: number;
  mid: number;
  treble: number;
};

export const ZERO_RECORDER_LEVELS: RecorderLevels = { level: 0, bass: 0, mid: 0, treble: 0 };

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stopped: Promise<Blob> | null = null;
  private resolveStop: ((blob: Blob) => void) | null = null;
  private rejectStop: ((error: unknown) => void) | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private levels: RecorderLevels = { ...ZERO_RECORDER_LEVELS };
  private startedAt = 0;
  private cancelled = false;

  get isActive(): boolean {
    return this.recorder !== null;
  }

  get durationMs(): number {
    return this.startedAt > 0 ? performance.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    if (this.recorder) throw new Error("La grabadora ya está activa.");
    this.cancelled = false;
    this.chunks = [];

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Este dispositivo no soporta grabación de audio.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      throw new Error("No se pudo acceder al micrófono. Revisa los permisos del sistema.");
    }

    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Cancelled", "AbortError");
    }

    this.stream = stream;
    this.setupAnalyser(stream);

    const mimeType = this.pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      this.cleanup();
      throw new Error("Este dispositivo no puede grabar audio.");
    }

    this.stopped = new Promise<Blob>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });

    this.recorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(this.chunks, { type });
      this.cleanup();
      this.resolveStop?.(blob);
      this.resolveStop = null;
      this.rejectStop = null;
    };

    recorder.onerror = () => {
      const error = new Error("La grabación falló.");
      this.cleanup();
      this.rejectStop?.(error);
      this.resolveStop = null;
      this.rejectStop = null;
    };

    recorder.start(100);
    this.startedAt = performance.now();
  }

  async stop(): Promise<Blob> {
    if (!this.recorder || !this.stopped) throw new Error("No hay grabación activa.");
    if (this.recorder.state !== "inactive") this.recorder.stop();
    return this.stopped;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
      return;
    }
    this.cleanup();
  }

  getLevels(): RecorderLevels {
    const analyser = this.analyser;
    const spectrum = this.spectrum;
    if (!analyser || !spectrum) {
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

  private setupAnalyser(stream: MediaStream): void {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.analyser = analyser;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
      void ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
      this.analyser = null;
      this.spectrum = null;
    }
  }

  private cleanup(): void {
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      this.recorder = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.analyser = null;
    this.spectrum = null;
    this.startedAt = 0;
    this.levels = { ...ZERO_RECORDER_LEVELS };
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

  private pickMimeType(): string | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return undefined;
  }
}
