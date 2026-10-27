'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresencePeer } from '../../lib/office/presence';
import { VOICE_ENDPOINT, VOICE_GATE, VOICE_RATE, createFramer, createResampler, fromPcm16, parseVoicePacket, rms, sameLevels, speakingLevels, toPcm16, voiceGain, voiceLevel, voicePan, type VoiceLevel, type VoicePose } from '../../lib/office/voice';

export type VoiceState = 'off' | 'asking' | 'on' | 'denied' | 'unavailable';
/** Posts each 128-sample mic block to the page; the page resamples and sends. */
const CAPTURE_WORKLET = `registerProcessor('backroom-voice-capture', class extends AudioWorkletProcessor {
  process(inputs) { const channel = inputs[0] && inputs[0][0]; if (channel) this.port.postMessage(channel.slice(0)); return true; }
});`;
/** Start a little ahead so packets that arrive unevenly still join up; drop backlog past MAX_AHEAD. */
const LEAD = 0.08, MAX_AHEAD = 0.4;

interface Speaker { gain: GainNode; pan: StereoPannerNode; next: number }
interface Session { context: AudioContext; stream: MediaStream; socket: WebSocket; speakers: Map<string, Speaker> }

function readPose(hud: { current: HTMLElement | null }, play: boolean): VoicePose | null {
  const data = hud.current?.dataset;
  if (!play || data?.playerX === undefined || data.playerZ === undefined) return play ? null : { x: 0, z: 0, yaw: 0, play: false };
  return { x: Number(data.playerX), z: Number(data.playerZ), yaw: Number(data.playerYaw ?? 0), play: true };
}
const peerPose = (peer: PresencePeer | undefined): VoicePose | null => peer ? { x: peer.x, z: peer.z, yaw: peer.yaw, play: peer.mode === 'play' } : null;

/**
 * Proximity voice through the demo host's relay. The mic button is the only way in: one click asks the browser
 * for the microphone, then you send and hear; off stops both. Loudness follows avatar distance in Play.
 */
export function useProximityVoice({ selfId, peers, hud, play }: {
  selfId: string; peers: readonly PresencePeer[]; hud: { current: HTMLElement | null }; play: boolean;
}) {
  const [state, setState] = useState<VoiceState>('off');
  const session = useRef<Session | null>(null);
  // Latest packet per speaker (self included, under selfId); rendered as talking icons ten times a second.
  const latest = useRef(new Map<string, { level: VoiceLevel; at: number }>());
  const [speaking, setSpeaking] = useState<Record<string, VoiceLevel>>({});
  const peersRef = useRef(peers);
  peersRef.current = peers;

  const stop = useCallback((next: VoiceState = 'off') => {
    const current = session.current;
    session.current = null;
    if (current) {
      current.socket.close();
      current.stream.getTracks().forEach(track => track.stop());
      void current.context.close().catch(() => {});
    }
    latest.current.clear();
    setSpeaking({});
    setState(next);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') { setState('unavailable'); return; }
    setState('asking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (error) {
      setState(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unavailable');
      return;
    }
    const context = new AudioContext();
    const url = new URL(`${VOICE_ENDPOINT}?viewer=${encodeURIComponent(selfId)}`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const current: Session = { context, stream, socket, speakers: new Map() };
    session.current = current;
    socket.onerror = () => { if (session.current === current) stop('unavailable'); };
    socket.onclose = () => { if (session.current === current) stop('unavailable'); };
    socket.onmessage = event => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const packet = parseVoicePacket(event.data);
      if (!packet) return;
      let speaker = current.speakers.get(packet.id);
      if (!speaker) {
        const gain = context.createGain(), pan = context.createStereoPanner();
        gain.connect(pan).connect(context.destination);
        speaker = { gain, pan, next: 0 };
        current.speakers.set(packet.id, speaker);
      }
      const samples = fromPcm16(packet.pcm);
      latest.current.set(packet.id, { level: voiceLevel(rms(samples)), at: performance.now() });
      const buffer = context.createBuffer(1, packet.pcm.length, VOICE_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(speaker.gain);
      const now = context.currentTime;
      let at = Math.max(speaker.next, now + LEAD);
      if (at - now > MAX_AHEAD) at = now + LEAD;
      source.start(at);
      speaker.next = at + buffer.duration;
    };
    try {
      await context.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' })));
    } catch { stop('unavailable'); return; }
    if (session.current !== current) return;
    const capture = new AudioWorkletNode(context, 'backroom-voice-capture');
    const resample = createResampler(context.sampleRate);
    const frame = createFramer(samples => {
      const loudness = rms(samples);
      if (socket.readyState !== WebSocket.OPEN || loudness < VOICE_GATE) return;
      socket.send(toPcm16(samples).buffer);
      latest.current.set(selfId, { level: voiceLevel(loudness), at: performance.now() });
    });
    capture.port.onmessage = event => frame(resample(event.data as Float32Array));
    // Capture runs through a silent gain so the browser keeps pulling the graph without echoing your own mic.
    const mute = context.createGain();
    mute.gain.value = 0;
    context.createMediaStreamSource(stream).connect(capture).connect(mute).connect(context.destination);
    await context.resume().catch(() => {});
    setState('on');
  }, [selfId, stop]);

  // Loudness and stereo position follow presence: 4 times a second, eased so a step never clicks.
  useEffect(() => {
    if (state !== 'on') return;
    const timer = window.setInterval(() => {
      const current = session.current;
      if (!current) return;
      const self = readPose(hud, play), now = current.context.currentTime;
      for (const [id, speaker] of current.speakers) {
        const peer = peerPose(peersRef.current.find(row => row.viewerId === id));
        speaker.gain.gain.setTargetAtTime(voiceGain(self, peer), now, 0.1);
        speaker.pan.pan.setTargetAtTime(voicePan(self, peer), now, 0.1);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [state, hud, play]);

  useEffect(() => {
    if (state !== 'on') return;
    const timer = window.setInterval(() => {
      const next = speakingLevels(latest.current, performance.now());
      setSpeaking(current => sameLevels(current, next) ? current : next);
    }, 100);
    return () => window.clearInterval(timer);
  }, [state]);

  const toggle = useCallback(() => {
    if (state === 'on' || state === 'asking') stop();
    else void start();
  }, [state, start, stop]);
  return { state, toggle, speaking };
}
