import { footstepLevel, footstepVoice, type FloorType } from '../../../lib/office/immersive/footsteps';
import { AMBIENCE_LAYERS, ambienceLevel, type AmbienceLayer, type Space } from '../../../lib/office/immersive/spaces';

/** Overall level, a touch under the office cue engine so the room sits behind the UI sounds. */
const MASTER_GAIN = 0.12;
const FADE_SECONDS = 0.25;
/** Seconds: time constant of the crossfade between spaces. */
const CROSSFADE = 0.7;
/** Event scheduler: wakes every TICK_MS and books keyboard ticks and bird calls up to LOOKAHEAD seconds ahead. */
const TICK_MS = 60;
const LOOKAHEAD = 0.2;
const FOOTSTEP_GAIN = 0.55;

/**
 * Procedural first-person audio for Play (WebAudio only, no files): footsteps with the floor's timbre and a
 * room ambience (lobby hum, break-room murmur, keyboard ticks, birds near the windows) that crossfades as the
 * player moves between spaces. Constructing it allocates nothing; `enable` must follow a user click.
 */
export class ImmersiveAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private layers: Partial<Record<AmbienceLayer, GainNode>> = {};
  private sources: AudioScheduledSourceNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextKey = 0;
  private nextBird = 0;
  private space: Space = 'aisle';
  private nearWindow = 0;
  private readonly visibility = () => this.syncVisibility();

  get running(): boolean { return !!this.context && this.context.state === 'running'; }

  enable(): void {
    if (this.context || typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) return;
      const ctx = this.context = new AudioContextCtor();
      const master = this.master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(MASTER_GAIN, ctx.currentTime + FADE_SECONDS);
      master.connect(ctx.destination);
      this.noise = whiteNoise(ctx, 2);
      this.buildHum(ctx, master);
      this.buildMurmur(ctx, master);
      this.layers.keys = layer(ctx, master);
      this.layers.birds = layer(ctx, master);
      this.applyMix(0.05);
      this.nextKey = this.nextBird = ctx.currentTime + 0.3;
      this.timer = setInterval(() => this.schedule(), TICK_MS);
      document.addEventListener('visibilitychange', this.visibility);
      this.syncVisibility();
    } catch { this.disable(); }
  }

  disable(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.context, master = this.master, sources = this.sources;
    this.context = null; this.master = null; this.noise = null; this.layers = {}; this.sources = [];
    if (!ctx || ctx.state === 'closed') return;
    const close = () => {
      sources.forEach(source => { try { source.stop(); } catch { /* already stopped */ } });
      try { void ctx.close().catch(() => {}); } catch { /* Audio is optional. */ }
    };
    try {
      if (ctx.state !== 'running' || !master) { close(); return; }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_SECONDS);
      setTimeout(close, FADE_SECONDS * 1000);
    } catch { close(); }
  }

  /** Crossfades the ambience toward `space` (and the birds toward the window nearness 0..1). */
  setSpace(space: Space, nearWindow: number): void {
    if (space === this.space && Math.abs(nearWindow - this.nearWindow) < 0.05) return;
    this.space = space;
    this.nearWindow = nearWindow;
    this.applyMix(CROSSFADE);
  }

  /** One footfall on `floor` at `speed` m/s. Hidden or suspended tabs drop it. */
  footstep(floor: FloorType, speed: number): boolean {
    const ctx = this.context, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise || ctx.state !== 'running' || document.hidden) return false;
    try {
      const voice = footstepVoice(floor), level = FOOTSTEP_GAIN * footstepLevel(speed) * (0.9 + Math.random() * 0.2);
      const start = ctx.currentTime + 0.005, detune = 0.94 + Math.random() * 0.12;
      const body = ctx.createOscillator(), bodyGain = ctx.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(voice.bodyHz * detune, start);
      body.frequency.exponentialRampToValueAtTime(voice.bodyEndHz * detune, start + voice.bodyDecay);
      envelope(bodyGain.gain, start, 0.004, voice.bodyDecay, voice.bodyGain * level);
      body.connect(bodyGain).connect(master);
      this.oneShot(body, start, voice.bodyDecay + 0.03, [bodyGain]);
      // The heel click: a short triangle blip, near-silent on carpet and absent on grass.
      if (voice.clickGain > 0) {
        const click = ctx.createOscillator(), clickGain = ctx.createGain();
        click.type = 'triangle';
        click.frequency.setValueAtTime(voice.clickHz * detune, start);
        envelope(clickGain.gain, start, 0.001, voice.clickDecay, voice.clickGain * level);
        click.connect(clickGain).connect(master);
        this.oneShot(click, start, voice.clickDecay + 0.02, [clickGain]);
      }
      const scuff = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), scuffGain = ctx.createGain();
      scuff.buffer = noise;
      filter.type = voice.noiseFilter; filter.frequency.value = voice.noiseHz * detune; filter.Q.value = voice.noiseQ;
      envelope(scuffGain.gain, start, 0.003, voice.noiseDecay, voice.noiseGain * level);
      scuff.connect(filter).connect(scuffGain).connect(master);
      this.oneShot(scuff, start, voice.noiseDecay + 0.03, [filter, scuffGain], Math.random() * 1.5);
      return true;
    } catch { return false; }
  }

  private applyMix(timeConstant: number): void {
    const ctx = this.context;
    if (!ctx) return;
    for (const name of AMBIENCE_LAYERS) {
      const node = this.layers[name];
      if (!node) continue;
      node.gain.cancelScheduledValues(ctx.currentTime);
      node.gain.setTargetAtTime(ambienceLevel(this.space, name, this.nearWindow), ctx.currentTime, timeConstant);
    }
  }

  /** Lobby hum: mains-like low sines and soft ventilation air. */
  private buildHum(ctx: AudioContext, master: GainNode): void {
    const out = this.layers.hum = layer(ctx, master);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 260;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.18;
    tone.connect(toneGain).connect(out);
    for (const [frequency, gain] of [[60, 0.5], [120.4, 0.35], [180.9, 0.12]] as const) {
      const osc = ctx.createOscillator(), level = ctx.createGain();
      osc.frequency.value = frequency; level.gain.value = gain;
      osc.connect(level).connect(tone);
      osc.start();
      this.sources.push(osc);
    }
    const air = this.loop(ctx), airFilter = ctx.createBiquadFilter(), airGain = ctx.createGain();
    airFilter.type = 'lowpass'; airFilter.frequency.value = 420; airGain.gain.value = 0.22;
    air.connect(airFilter).connect(airGain).connect(out);
  }

  /** Break-room murmur: noise through voice-band filters whose levels drift like overlapping chatter. */
  private buildMurmur(ctx: AudioContext, master: GainNode): void {
    const out = this.layers.murmur = layer(ctx, master);
    for (const [frequency, rate, depth] of [[340, 0.31, 0.5], [620, 0.47, 0.6], [1050, 0.23, 0.4]] as const) {
      const source = this.loop(ctx), band = ctx.createBiquadFilter(), voice = ctx.createGain();
      band.type = 'bandpass'; band.frequency.value = frequency; band.Q.value = 2.2;
      voice.gain.value = 0.22;
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = rate; lfoGain.gain.value = 0.22 * depth;
      lfo.connect(lfoGain).connect(voice.gain);
      lfo.start();
      this.sources.push(lfo);
      source.connect(band).connect(voice).connect(out);
    }
  }

  /** Books keyboard ticks and bird calls ahead of the clock, only while their layer is audible. */
  private schedule(): void {
    const ctx = this.context, noise = this.noise;
    if (!ctx || !noise || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    const keys = ambienceLevel(this.space, 'keys', this.nearWindow), birds = ambienceLevel(this.space, 'birds', this.nearWindow);
    if (this.nextKey < ctx.currentTime) this.nextKey = ctx.currentTime + 0.02;
    while (this.nextKey < horizon) {
      if (keys > 0.02) this.keyTick(ctx, noise, this.nextKey);
      // Typing comes in bursts: mostly 70-190 ms apart, now and then a pause to read.
      this.nextKey += Math.random() < 0.08 ? 0.6 + Math.random() * 1.4 : 0.07 + Math.random() * 0.12;
    }
    if (this.nextBird < ctx.currentTime) this.nextBird = ctx.currentTime + 0.05;
    while (this.nextBird < horizon) {
      if (birds > 0.02) this.birdCall(ctx, this.nextBird);
      this.nextBird += 1.8 + Math.random() * 4.5;
    }
  }

  private keyTick(ctx: AudioContext, noise: AudioBuffer, at: number): void {
    const out = this.layers.keys;
    if (!out) return;
    const tick = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    tick.buffer = noise;
    filter.type = 'bandpass'; filter.frequency.value = 2400 + Math.random() * 2200; filter.Q.value = 3;
    envelope(gain.gain, at, 0.001, 0.025, 0.25 + Math.random() * 0.2);
    tick.connect(filter).connect(gain).connect(out);
    this.oneShot(tick, at, 0.05, [filter, gain], Math.random() * 1.8);
  }

  private birdCall(ctx: AudioContext, at: number): void {
    const out = this.layers.birds;
    if (!out) return;
    const chirps = 2 + Math.floor(Math.random() * 3), base = 2600 + Math.random() * 1400;
    for (let i = 0; i < chirps; i++) {
      const start = at + i * (0.09 + Math.random() * 0.05), length = 0.06 + Math.random() * 0.05;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), start + length);
      envelope(gain.gain, start, 0.01, length, 0.12);
      osc.connect(gain).connect(out);
      this.oneShot(osc, start, length + 0.02, [gain]);
    }
  }

  private loop(ctx: AudioContext): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = this.noise; source.loop = true;
    source.start(0, Math.random() * 1.5);
    this.sources.push(source);
    return source;
  }

  /** Starts a short source and disconnects it and its `chain` once it ends. */
  private oneShot(source: AudioScheduledSourceNode, start: number, length: number, chain: readonly AudioNode[], offset = 0): void {
    source.onended = () => { source.disconnect(); for (const node of chain) node.disconnect(); };
    if (source instanceof AudioBufferSourceNode) source.start(start, offset, length);
    else { source.start(start); source.stop(start + length); }
  }

  private syncVisibility(): void {
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed') return;
    try { void (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {}); } catch { /* Audio is optional. */ }
  }
}

function layer(ctx: AudioContext, master: GainNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  return gain;
}

function whiteNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function envelope(param: AudioParam, start: number, attack: number, decay: number, peak: number): void {
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  param.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}
