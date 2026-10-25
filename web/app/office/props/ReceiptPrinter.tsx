'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { RECEIPT_PRINT_MS, hasNewAuditRow, receiptExtension } from '../../../lib/office/props/receiptPrinter';
import type { SceneMountProps } from '../mounts/types';
import { useReducedMotion } from './useReducedMotion';
import { LOBBY_KIOSK } from '../../../lib/office/layout';

const [KIOSK_X, KIOSK_Z] = LOBBY_KIOSK;

function Printer({ snapshot }: SceneMountProps) {
  const paper = useRef<Mesh>(null);
  const previous = useRef(snapshot);
  const started = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const still = reduced || snapshot.connection === 'replay';
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    if (still) started.current = null;
    else if (hasNewAuditRow(previous.current, snapshot)) started.current = performance.now();
    previous.current = snapshot;
    invalidate();
  }, [snapshot, still, invalidate]);
  useFrame(state => {
    if (!paper.current) return;
    const age = started.current === null ? RECEIPT_PRINT_MS : performance.now() - started.current;
    const length = receiptExtension(still ? RECEIPT_PRINT_MS : age);
    paper.current.scale.y = length;
    paper.current.position.y = 0.19 + length / 2;
    if (!still && started.current !== null && age < RECEIPT_PRINT_MS) state.invalidate();
    else started.current = null;
  });
  return <group name='prop:receipt-printer' position={[KIOSK_X + 0.24, 0.78, KIOSK_Z]}>
    <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.29, 0.2, 0.36]} /><meshStandardMaterial color='#272f25' roughness={0.8} />
    </mesh>
    <mesh position={[0, 0.202, 0.045]}>
      <boxGeometry args={[0.22, 0.008, 0.035]} /><meshStandardMaterial color='#101810' />
    </mesh>
    <mesh ref={paper} position={[0, 0.2025, 0.045]} scale={[1, 0.025, 1]}>
      <boxGeometry args={[0.19, 1, 0.007]} /><meshStandardMaterial color='#e7ddc5' roughness={1} />
    </mesh>
    <mesh position={[0.1, 0.14, 0.181]}>
      <boxGeometry args={[0.025, 0.018, 0.005]} /><meshBasicMaterial color='#f3dfb9' />
    </mesh>
  </group>;
}

/** Audit decoration only. No receipt writes or printing API. */
export function ReceiptPrinter({ snapshot }: SceneMountProps) {
  return visibleRooms(snapshot).includes('lobby') ? <Printer snapshot={snapshot} /> : null;
}
