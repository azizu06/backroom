import { REDUCED_MOTION_QUERY } from './a11y';
import { SOUND_CUES, type OneShotCue } from './sound';

const MASTER_GAIN = 0.15;
const FADE_SECONDS = 0.08;

/** Local view audio only. Constructing this class allocates no audio resources. */
export class OfficeSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private tone: OscillatorNode[] = [];
  private toneFilter: BiquadFilterNode | null = null;
  private toneGain: GainNode | null = null;
  private reduced: MediaQueryList | null = null;
  private readonly visibility = () => this.syncVisibility();
  private readonly motion = () => this.syncTone();

  /** Call synchronously from a user click, including when restoring an on preference. */
  enable(): void {
    if (this.context || typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) return;
      const ctx = this.context = new AudioContextCtor();
      this.master = ctx.createGain();
      this.master.gain.setValueAtTime(0, ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(MASTER_GAIN, ctx.currentTime + FADE_SECONDS);
      this.master.connect(ctx.destination);
      this.reduced = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
      this.reduced?.addEventListener('change', this.motion);
      document.addEventListener('visibilitychange', this.visibility);
      this.syncVisibility();
    } catch { this.disable(); }
  }

  /** Suspended/hidden tabs drop cues instead of queuing a burst for their return. */
  play(kind: OneShotCue): boolean {
    const ctx = this.context, master = this.master;
    if (!ctx || !master || ctx.state !== 'running' || document.hidden) return false;
    try {
      const cue = SOUND_CUES[kind], start = ctx.currentTime;
      cue.frequencies.forEach(frequency => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        const end = start + (cue.attackMs + cue.releaseMs) / 1000;
        osc.type = cue.oscillator;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(cue.gain / cue.frequencies.length, start + cue.attackMs / 1000);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        gain.gain.linearRampToValueAtTime(0, end + 0.02);
        osc.connect(gain).connect(master);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        osc.start(start);
        osc.stop(end + 0.02);
      });
      return true;
    } catch { return false; }
  }

  disable(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    this.reduced?.removeEventListener('change', this.motion);
    this.reduced = null;
    const ctx = this.context, master = this.master, tone = this.tone;
    this.context = null; this.master = null;
    this.tone = []; this.toneFilter = null; this.toneGain = null;
    if (!ctx || ctx.state === 'closed') return;
    const close = () => {
      tone.forEach(osc => { try { osc.stop(); } catch { /* already stopped */ } });
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

  private syncVisibility(): void {
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed') return;
    try {
      this.syncTone();
      void (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {});
    } catch { /* Audio is optional. */ }
  }

  private syncTone(): void {
    const ctx = this.context, master = this.master;
    if (!ctx || !master) return;
    if (document.hidden || this.reduced?.matches) { this.stopTone(); return; }
    if (this.tone.length) return;
    try {
      const cue = SOUND_CUES.roomTone;
      const filter = this.toneFilter = ctx.createBiquadFilter();
      const gain = this.toneGain = ctx.createGain();
      filter.type = 'lowpass'; filter.frequency.value = 190;
      filter.connect(gain).connect(master);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      // About -38 dB before the low master volume, shared by two detuned sines.
      gain.gain.linearRampToValueAtTime(cue.gain / cue.frequencies.length, ctx.currentTime + cue.attackMs / 1000);
      for (const frequency of cue.frequencies) {
        const osc = ctx.createOscillator();
        this.tone.push(osc);
        osc.type = cue.oscillator; osc.frequency.value = frequency;
        osc.connect(filter); osc.start();
      }
    } catch { this.stopTone(); }
  }

  private stopTone(): void {
    this.tone.forEach(osc => { try { osc.stop(); osc.disconnect(); } catch { /* already stopped */ } });
    this.toneFilter?.disconnect(); this.toneGain?.disconnect();
    this.tone = []; this.toneFilter = null; this.toneGain = null;
  }
}
