'use client';

type WakeLockSentinel = { released: boolean; release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } };

/** Chime, vibration and screen wake for the controller phone. Every call is best effort: a
 * browser that blocks one still shows the request, which is the part that matters. */
export function createControllerAlert() {
  let audio: AudioContext | undefined;
  let lock: WakeLockSentinel | undefined;
  return {
    /** Call from a tap: iOS only lets a page play sound after a user gesture has resumed its context. */
    unlock() {
      try {
        audio ??= new AudioContext();
        if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
      } catch { /* no Web Audio */ }
    },
    get soundReady() { return audio?.state === 'running'; },
    ring() {
      try {
        audio ??= new AudioContext();
        const start = audio.currentTime + 0.02;
        for (const [i, freq] of [880, 1318.5].entries()) {
          const tone = audio.createOscillator(), gain = audio.createGain();
          const at = start + i * 0.16;
          tone.type = 'sine'; tone.frequency.value = freq;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(0.25, at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
          tone.connect(gain).connect(audio.destination);
          tone.start(at); tone.stop(at + 0.34);
        }
      } catch { /* no Web Audio */ }
      try { navigator.vibrate?.([180, 80, 180]); } catch { /* iOS Safari has no vibration API */ }
    },
    /** Keeps the screen on while Dana waits; the browser drops it when the tab hides, so re-request on return. */
    async keepAwake() {
      if (lock && !lock.released) return true;
      try { lock = await (navigator as WakeLockNavigator).wakeLock?.request('screen'); } catch { lock = undefined; }
      return !!lock;
    },
  };
}
