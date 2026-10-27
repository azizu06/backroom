import { expect, it } from 'vitest';
import { VOICE_FRAME, createFramer, createResampler, parseVoicePacket, voiceGain, voicePan, type VoicePose } from './voice';

const at = (x: number, z: number, yaw = 0, play = true): VoicePose => ({ x, z, yaw, play });

it('fades with distance in Play and is one room everywhere else', () => {
  expect(voiceGain(at(0, 0), at(1, 1))).toBe(1);
  expect(voiceGain(at(0, 0), at(5, 0))).toBeCloseTo(0.5);
  expect(voiceGain(at(0, 0), at(9, 0))).toBe(0);
  expect(voiceGain(at(0, 0, 0, false), at(9, 0))).toBe(1);
  expect(voiceGain(at(0, 0), null)).toBe(1);
});

it('pans toward the side the speaker is on, relative to where you face', () => {
  expect(voicePan(at(0, 0), at(3, 0))).toBeCloseTo(0.8);
  expect(voicePan(at(0, 0), at(-3, 0))).toBeCloseTo(-0.8);
  expect(voicePan(at(0, 0), at(0, -3))).toBeCloseTo(0);
  // Turned to face +x (yaw -90°), a speaker at +x is straight ahead and one at +z is to the right.
  expect(voicePan(at(0, 0, -Math.PI / 2), at(3, 0))).toBeCloseTo(0);
  expect(voicePan(at(0, 0, -Math.PI / 2), at(0, 3))).toBeCloseTo(0.8);
  expect(voicePan(at(0, 0, 0, false), at(3, 0))).toBe(0);
});

it('resamples 48 kHz blocks to 16 kHz without drift and frames them in 20 ms', () => {
  const resample = createResampler(48_000);
  let total = 0;
  for (let i = 0; i < 375; i++) total += resample(new Float32Array(128).fill(0.5)).length; // one second
  expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
  const frames: number[] = [];
  const frame = createFramer(samples => frames.push(samples.length));
  frame(new Float32Array(500)); frame(new Float32Array(500));
  expect(frames).toEqual([VOICE_FRAME, VOICE_FRAME, VOICE_FRAME]);
});

it('parses relay packets and rejects malformed ones', () => {
  const id = new TextEncoder().encode('alice-0001');
  const packet = new Uint8Array([id.length, ...id, 1, 0, 255, 255]);
  expect(parseVoicePacket(packet.buffer)).toEqual({ id: 'alice-0001', pcm: new Int16Array([1, -1]) });
  expect(parseVoicePacket(new Uint8Array([id.length, ...id, 1]).buffer)).toBeNull();
  expect(parseVoicePacket(new Uint8Array([3, 97, 98, 99, 0, 0]).buffer)).toBeNull();
});
