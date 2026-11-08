import type { SoundEvent, StressBed } from './physics';

export type EditSound = 'beamPlace' | 'nodeCreate' | 'copy' | 'paste';
type Sample = EditSound | SoundEvent['kind'] | 'beamTensionLoop' | 'ropeTensionLoop';
type LoopVoice = { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; panner: StereoPannerNode; timer?: ReturnType<typeof setTimeout> };
const STORAGE_KEY = 'bar-lab:sound-enabled:v1';
const MAX_EFFECTS = 4;
const SAMPLES: Sample[] = ['beamPlace', 'nodeCreate', 'copy', 'paste', 'beamStress', 'ropeStress', 'ropeBreak', 'beamWall', 'beamGround', 'ropeGround', 'beamTensionLoop', 'ropeTensionLoop'];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export class SoundEngine {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: DynamicsCompressorNode | null = null;
  private buffers = new Map<Sample, AudioBuffer>();
  private loading = new Map<Sample, Promise<AudioBuffer | null>>();
  private effects = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  private loops = new Map<string, LoopVoice>();
  private startingLoops = new Set<string>();
  private targets = new Map<string, { bed: StressBed; width: number }>();
  private simulationActive = false;
  private generation = 0;

  constructor() {
    try { this.enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* Private storage can be unavailable. */ }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Keep the current session's preference. */ }
    if (!enabled) {
      this.generation++;
      this.stopAll();
    } else this.activate();
  }

  activate(): void {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -18; limiter.knee.value = 16; limiter.ratio.value = 8;
        limiter.attack.value = .004; limiter.release.value = .18;
        this.master = this.context.createGain(); this.master.gain.value = .65;
        // A single output limiter catches a rare overlap of six beds and four
        // impacts without requiring a compressor for every short-lived voice.
        limiter.connect(this.master).connect(this.context.destination);
        this.output = limiter;
      }
      if (this.context.state === 'suspended') void this.context.resume();
      // Each URL and decoded buffer is reused across all placements and runs.
      for (const name of SAMPLES) void this.load(name);
    } catch { /* Audio is optional on unsupported devices. */ }
  }

  setSimulationActive(active: boolean): void {
    this.simulationActive = active;
    if (active) { this.activate(); return; }
    this.targets.clear();
    this.generation++;
    for (const voice of this.loops.values()) this.stopLoop(voice, true);
    this.loops.clear();
    this.startingLoops.clear();
    for (const effect of this.effects) { try { effect.source.stop(); } catch { /* Already ended. */ } }
    this.effects.clear();
  }

  playEdit(kind: EditSound, x = .5): void {
    const level: Record<EditSound, number> = { beamPlace: .3, nodeCreate: .17, copy: .12, paste: .25 };
    void this.playSample(kind, x, level[kind], 1);
  }

  playSimulation(event: SoundEvent, width: number): void {
    if (!this.simulationActive) return;
    const level: Record<SoundEvent['kind'], number> = { beamStress: .23, ropeStress: .19, ropeBreak: .38, beamWall: .31, beamGround: .34, ropeGround: .22 };
    const reference = event.kind.startsWith('rope') ? 4 : 3;
    const rate = clamp(Math.sqrt(reference / Math.max(.5, event.length)), .78, 1.3);
    void this.playSample(event.kind, width > 0 ? event.x / width : .5, level[event.kind] * clamp(event.intensity, .25, 1), rate);
  }

  updateBeds(beds: StressBed[], width: number): void {
    if (!this.enabled || !this.simulationActive) return;
    this.targets.clear();
    for (const bed of beds) {
      const key = `${bed.material}:${bed.zone}`;
      this.targets.set(key, { bed, width });
      const voice = this.loops.get(key);
      if (voice) this.shapeLoop(voice, bed, width);
      else void this.startLoop(key, bed.material);
    }
    for (const [key, voice] of this.loops) if (!this.targets.has(key)) {
      this.silenceLoop(voice);
      // A quiet zone releases its buffer source instead of running forever.
      voice.timer ??= setTimeout(() => { if (!this.targets.has(key)) { this.stopLoop(voice); this.loops.delete(key); } }, 350);
    }
  }

  private load(name: Sample): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(name);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.loading.get(name);
    if (inFlight) return inFlight;
    const context = this.context;
    if (!context) return Promise.resolve(null);
    const promise = fetch(new URL(`./sounds/${name}.wav`, document.baseURI))
      .then(response => { if (!response.ok) throw new Error(`Sound ${name} unavailable`); return response.arrayBuffer(); })
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => { this.buffers.set(name, buffer); return buffer; })
      .catch(() => null);
    this.loading.set(name, promise);
    return promise;
  }

  private async playSample(name: Sample, x: number, level: number, rate: number): Promise<void> {
    if (!this.enabled) return;
    this.activate();
    const generation = this.generation;
    const buffer = await this.load(name), context = this.context;
    if (!buffer || !context || !this.enabled || generation !== this.generation || this.effects.size >= MAX_EFFECTS) return;
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = level;
    panner.pan.value = clamp((x - .5) * 1.7, -.85, .85);
    source.connect(gain).connect(panner).connect(this.output!);
    const effect = { source, gain };
    this.effects.add(effect);
    source.onended = () => { this.effects.delete(effect); source.disconnect(); gain.disconnect(); panner.disconnect(); };
    source.start();
  }

  private async startLoop(key: string, material: StressBed['material']): Promise<void> {
    if (this.startingLoops.has(key)) return;
    this.startingLoops.add(key);
    const generation = this.generation;
    const buffer = await this.load(material === 'beam' ? 'beamTensionLoop' : 'ropeTensionLoop');
    const context = this.context, target = this.targets.get(key);
    this.startingLoops.delete(key);
    if (!buffer || !context || !target || !this.enabled || !this.simulationActive || generation !== this.generation || this.loops.has(key)) return;
    const source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter(), panner = context.createStereoPanner();
    source.buffer = buffer;
    source.loop = true;
    filter.type = 'lowpass';
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(panner).connect(this.output!);
    const voice = { source, gain, filter, panner };
    this.loops.set(key, voice);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); };
    this.shapeLoop(voice, target.bed, target.width);
    source.start();
  }

  private shapeLoop(voice: LoopVoice, bed: StressBed, width: number): void {
    if (voice.timer) { clearTimeout(voice.timer); voice.timer = undefined; }
    const now = this.context!.currentTime;
    const reference = bed.material === 'beam' ? 3 : 4;
    const lengthFactor = clamp(Math.sqrt(reference / Math.max(.5, bed.length)), .73, 1.35);
    // Log compression makes a larger loaded group audible without multiplying
    // loudness by every beam or cable in a dense construction.
    const level = clamp(.13 * Math.log1p(bed.load) * (.65 + .4 * bed.stress), 0, .38);
    voice.gain.gain.setTargetAtTime(level, now, .08);
    voice.source.playbackRate.setTargetAtTime(lengthFactor * (1 + .07 * Math.min(1.5, bed.stress)), now, .12);
    voice.filter.frequency.setTargetAtTime((bed.material === 'beam' ? 1450 : 2300) * lengthFactor * (1 + .28 * Math.min(1.5, bed.stress)), now, .1);
    voice.panner.pan.setTargetAtTime(clamp((bed.x / width - .5) * 1.7, -.85, .85), now, .1);
  }

  private silenceLoop(voice: LoopVoice): void {
    voice.gain.gain.setTargetAtTime(0, this.context!.currentTime, .06);
  }

  private stopLoop(voice: LoopVoice, fade = false): void {
    if (voice.timer) clearTimeout(voice.timer);
    if (fade) this.silenceLoop(voice);
    try { voice.source.stop(this.context!.currentTime + (fade ? .16 : 0)); } catch { /* Already stopped. */ }
  }

  private stopAll(): void {
    this.targets.clear();
    for (const voice of this.loops.values()) this.stopLoop(voice);
    this.loops.clear();
    this.startingLoops.clear();
    for (const effect of this.effects) { effect.gain.gain.value = 0; try { effect.source.stop(); } catch { /* Already ended. */ } }
    this.effects.clear();
  }
}
