/**
 * Proximity voice, browser side: pure helpers for the demo host's relay (lib/demo/voice-relay). Voice is
 * human-to-human chat only; nothing here reaches agents, approvals or the record (AGENTS.md §8).
 */
export const VOICE_ENDPOINT = '/__voice';
export const VOICE_RATE = 16_000;
/** 20 ms per packet. */
export const VOICE_FRAME = 320;
/** Full volume within NEAR metres in Play, silent beyond FAR (the text chat radius is 6 m). */
export const VOICE_NEAR = 2;
export const VOICE_FAR = 8;
/** Frames quieter than this RMS are not sent. */
export const VOICE_GATE = 0.004;

export interface VoicePose { x: number; z: number; yaw: number; play: boolean }

/**
 * Loudness of a peer: in Play both people hear by distance; anywhere else (overview, or a pose not known yet)
 * the office is one room and everyone is heard at full volume.
 */
export function voiceGain(self: VoicePose | null, peer: VoicePose | null): number {
  if (!self?.play || !peer?.play) return 1;
  const distance = Math.hypot(peer.x - self.x, peer.z - self.z);
  return Math.max(0, Math.min(1, (VOICE_FAR - distance) / (VOICE_FAR - VOICE_NEAR)));
}

/** Stereo position of a peer relative to where self faces (yaw 0 looks toward -z); 0 outside Play. */
export function voicePan(self: VoicePose | null, peer: VoicePose | null): number {
  if (!self?.play || !peer?.play) return 0;
  const dx = peer.x - self.x, dz = peer.z - self.z, distance = Math.hypot(dx, dz);
  if (distance < 0.01) return 0;
  const right = dx * Math.cos(self.yaw) - dz * Math.sin(self.yaw);
  return Math.max(-0.8, Math.min(0.8, (right / distance) * 0.8));
}

/** Streaming linear resampler to VOICE_RATE; keeps its fractional position across blocks. */
export function createResampler(inputRate: number) {
  const step = inputRate / VOICE_RATE;
  let position = 0, previous = 0;
  return (input: Float32Array): Float32Array => {
    const out: number[] = [];
    while (position < input.length) {
      const index = Math.floor(position), fraction = position - index;
      const a = index === 0 ? previous : input[index - 1]!, b = input[index]!;
      // Sample i of this block sits at position i + 1 relative to the carried previous sample.
      out.push(a + (b - a) * fraction);
      position += step;
    }
    position -= input.length;
    previous = input[input.length - 1] ?? previous;
    return Float32Array.from(out);
  };
}

export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767);
  return pcm;
}
export function fromPcm16(pcm: Int16Array): Float32Array {
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i]! / 32768;
  return samples;
}
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Splits a relay packet ([id length][id][PCM]) or returns null for anything malformed. */
export function parseVoicePacket(data: ArrayBuffer): { id: string; pcm: Int16Array } | null {
  const bytes = new Uint8Array(data);
  const length = bytes[0] ?? 0, start = 1 + length;
  if (length < 8 || length > 64 || bytes.length <= start || (bytes.length - start) % 2) return null;
  const id = new TextDecoder().decode(bytes.subarray(1, start));
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
  // Copy so the samples are aligned regardless of the id length.
  return { id, pcm: new Int16Array(bytes.slice(start).buffer) };
}

/** Talking indicator: 0 silent, then 1-3 waves by loudness of the latest packet. */
export type VoiceLevel = 0 | 1 | 2 | 3;
/** A speaker stays "talking" this long after their last packet, so the icon does not flicker between words. */
export const SPEAKING_HOLD_MS = 350;
export function voiceLevel(value: number): VoiceLevel {
  return value < VOICE_GATE ? 0 : value < 0.03 ? 1 : value < 0.08 ? 2 : 3;
}
/** Who is talking right now and how loudly, from each speaker's latest packet. */
export function speakingLevels(latest: ReadonlyMap<string, { level: VoiceLevel; at: number }>, now: number): Record<string, VoiceLevel> {
  const out: Record<string, VoiceLevel> = {};
  for (const [id, { level, at }] of latest) if (level && now - at < SPEAKING_HOLD_MS) out[id] = level;
  return out;
}
export function sameLevels(a: Record<string, VoiceLevel>, b: Record<string, VoiceLevel>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/** Collects resampled audio into whole 20 ms frames. */
export function createFramer(onFrame: (frame: Float32Array) => void) {
  let pending: number[] = [];
  return (samples: Float32Array) => {
    for (const value of samples) pending.push(value);
    while (pending.length >= VOICE_FRAME) {
      onFrame(Float32Array.from(pending.slice(0, VOICE_FRAME)));
      pending = pending.slice(VOICE_FRAME);
    }
  };
}
