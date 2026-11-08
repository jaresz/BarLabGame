import type { SoundEvent } from './physics';

export type EditSound = 'beamPlace' | 'nodeCreate' | 'copy' | 'paste';
const STORAGE_KEY = 'bar-lab:sound-enabled:v1';
const MAX_VOICES = 5;

export class SoundEngine {
  enabled = true;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Set<{ gain: GainNode; sources: AudioScheduledSourceNode[] }>();

  constructor() {
    try { this.enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* Private storage can be unavailable. */ }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Keep the current session's preference. */ }
    if (!enabled) {
      for (const voice of this.voices) {
        voice.gain.gain.setValueAtTime(0, this.context?.currentTime ?? 0);
        for (const source of voice.sources) { try { source.stop(); } catch { /* It may already have ended. */ } }
      }
      this.voices.clear();
    }
  }

  activate(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch { /* Audio is an optional enhancement on unsupported devices. */ }
  }

  playEdit(kind: EditSound, x = 0.5): void {
    const config: Record<EditSound, [number, number, number, number]> = {
      beamPlace: [430, 170, 0.19, 0.11],
      nodeCreate: [690, 940, 0.11, 0.065],
      copy: [620, 820, 0.14, 0.07],
      paste: [370, 600, 0.24, 0.12],
    };
    const [from, to, duration, level] = config[kind];
    this.play(from, to, duration, level, x, kind === 'beamPlace' || kind === 'paste' ? 0.22 : 0.04);
  }

  playSimulation(event: SoundEvent, width: number): void {
    const pan = width > 0 ? event.x / width : 0.5;
    const config: Record<SoundEvent['kind'], [number, number, number, number, number]> = {
      beamStress: [190, 115, 0.32, 0.065, 0.35],
      ropeBreak: [980, 170, 0.42, 0.13, 0.72],
      beamWall: [300, 95, 0.3, 0.14, 0.55],
      beamGround: [230, 75, 0.38, 0.16, 0.6],
      ropeGround: [700, 210, 0.22, 0.09, 0.42],
    };
    const [from, to, duration, level, noise] = config[event.kind];
    this.play(from, to, duration, level * Math.max(0.25, event.intensity), pan, noise);
  }

  private play(from: number, to: number, duration: number, level: number, x: number, noiseAmount: number): void {
    if (!this.enabled) return;
    this.activate();
    const context = this.context;
    if (!context || context.state !== 'running' || this.voices.size >= MAX_VOICES) return;
    const now = context.currentTime;
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    // Board X is normalized to [0, 1], then mapped to full left/right stereo.
    panner.pan.value = Math.max(-0.85, Math.min(0.85, (x - 0.5) * 1.7));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(panner).connect(context.destination);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    oscillator.connect(gain);
    const sources: AudioScheduledSourceNode[] = [oscillator];
    if (noiseAmount > 0) {
      if (!this.noise) {
        this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      const hiss = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const noiseGain = context.createGain();
      hiss.buffer = this.noise;
      filter.type = 'bandpass'; filter.frequency.value = Math.max(300, from * 2);
      noiseGain.gain.value = noiseAmount;
      hiss.connect(filter).connect(noiseGain).connect(gain);
      hiss.start(now); hiss.stop(now + duration);
      sources.push(hiss);
    }
    const voice = { gain, sources };
    this.voices.add(voice);
    oscillator.onended = () => { this.voices.delete(voice); gain.disconnect(); panner.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration);
  }
}
