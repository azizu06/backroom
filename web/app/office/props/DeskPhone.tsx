'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial } from 'three';
import { callStore, soundEnabled } from '../../../lib/office/calls';
import { PHONE_STAND } from '../../../lib/office/props/phone';
import { REDUCED_MOTION_QUERY } from '../../../lib/office/a11y';
import { OFFICE_ANCHORS, visibleRooms, type OfficeSnapshot } from '../../../lib/office/state';
import { useCanvasTexture } from './useCanvasTexture';

const PHONE_X = OFFICE_ANCHORS.collections.center[0] + 0.85;
const PHONE_Z = OFFICE_ANCHORS.collections.center[1] + 0.3;
function Screen({ label }: { label: string }) {
  const texture = useCanvasTexture(256, 96, ctx => {
    ctx.fillStyle = '#18201b'; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#d8e5d0'; ctx.font = '600 25px system-ui'; ctx.fillText(label.slice(0, 20), 12, 55);
  }, [label]);
  return <mesh position={[0.06, 1.074, 0.015]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[0.22, 0.08]} /><meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
}
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

export function DeskPhone({ snapshot }: { snapshot: OfficeSnapshot }) {
  const call = useSyncExternalStore(callStore.subscribe, callStore.getSnapshot, callStore.getServerSnapshot);
  const visible = visibleRooms(snapshot).includes('collections');
  const ringing = visible && call.status === 'ringing';
  const invalidate = useThree(state => state.invalidate);
  const reduced = useReducedMotion();
  const handset = useRef<Mesh>(null);
  const light = useRef<MeshStandardMaterial>(null);
  const phase = useRef(0);
  useEffect(() => { invalidate(); }, [call, invalidate]);
  useEffect(() => {
    if (handset.current) handset.current.rotation.z = 0.1;
    if (light.current) light.current.emissiveIntensity = 0.7;
    invalidate();
  }, [ringing, reduced, invalidate]);
  useEffect(() => {
    if (!ringing || !soundEnabled()) return;
    let context: AudioContext | undefined;
    let oscillator: OscillatorNode | undefined;
    let gain: GainNode | undefined;
    try {
      context = new AudioContext(); oscillator = context.createOscillator(); gain = context.createGain();
      oscillator.frequency.value = 440; gain.gain.value = 0; oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start();
      void context.resume().catch(() => {});
      const now = context.currentTime;
      // Two brief bursts followed by silence, repeated as a conventional ring cadence.
      for (let cycle = 0; cycle < 8; cycle++) {
        const start = now + cycle * 3;
        gain.gain.setValueAtTime(0, start);
        gain.gain.setValueAtTime(0.025, start + 0.01);
        gain.gain.setValueAtTime(0, start + 0.41);
        gain.gain.setValueAtTime(0.025, start + 0.61);
        gain.gain.setValueAtTime(0, start + 1.01);
      }
    } catch { /* Audio is optional. */ }
    return () => {
      try { oscillator?.stop(); } catch { /* Audio is optional. */ }
      void context?.close().catch(() => {});
    };
  }, [ringing]);
  useFrame((_, delta) => {
    if (!ringing) return;
    phase.current += delta;
    if (handset.current) handset.current.rotation.z = reduced ? 0.1 : 0.1 + Math.sin(phase.current * 18) * 0.035;
    if (light.current) light.current.emissiveIntensity = reduced ? 1.4 : 0.8 + (Math.sin(phase.current * 10) + 1) * 0.5;
    if (!reduced) invalidate();
  });
  const color = call.status === 'live' ? '#5ed07b' : call.status === 'ringing' ? '#e8bd52' : call.status === 'ended' ? '#a74c42' : '#253028';
  const liveLabel = call.status === 'live' ? call.agentName ?? 'Collections' : '';
  if (!visible) return null;
  return <group name='prop:desk-phone' position={[0, 0, 0]}>
    <mesh position={[PHONE_STAND.x, 0.36, PHONE_STAND.z]}>
      <boxGeometry args={[PHONE_STAND.width, 0.72, PHONE_STAND.depth]} />
      <meshStandardMaterial color='#4a3b32' roughness={0.8} />
    </mesh>
    <group position={[PHONE_X, 0, PHONE_Z]}>
      <mesh position={[0, 0.96, 0]}><boxGeometry args={[0.34, 0.09, 0.25]} /><meshStandardMaterial color='#26332b' roughness={0.62} /></mesh>
      <mesh position={[0, 1.014, 0]}><boxGeometry args={[0.31, 0.025, 0.22]} /><meshStandardMaterial color='#4b5b50' roughness={0.4} /></mesh>
      <mesh position={[0.06, 1.055, 0.015]} rotation={[0, 0, -0.2]}><boxGeometry args={[0.2, 0.035, 0.11]} /><meshStandardMaterial color='#101713' /></mesh>
      <mesh ref={handset} position={[0, 1.105, -0.015]} rotation={[0, 0, 0.1]}>
        <boxGeometry args={[0.29, 0.055, 0.06]} /><meshStandardMaterial color='#1b231e' roughness={0.48} />
      </mesh>
      <mesh position={[-0.11, 1.108, -0.015]}><boxGeometry args={[0.055, 0.075, 0.09]} /><meshStandardMaterial color='#303d34' /></mesh>
      <mesh position={[0.11, 1.108, -0.015]}><boxGeometry args={[0.055, 0.075, 0.09]} /><meshStandardMaterial color='#303d34' /></mesh>
      <mesh position={[-0.12, 1.02, -0.06]}><sphereGeometry args={[0.018, 8, 8]} /><meshStandardMaterial ref={light} color={color} emissive={color} emissiveIntensity={call.status === 'ringing' && reduced ? 1.4 : 0.7} /></mesh>
      {call.status === 'live' && <Screen label={liveLabel} />}
    </group>
  </group>;
}
