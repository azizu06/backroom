'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, type Object3D } from 'three';
import { anchoredCard } from './cardAnchor';
import { usePlayCamera } from './usePlayCamera';

const HEAD_Y = 1.9;
const EDGE = 12;

/**
 * Pins the open agent card (PlayHud dialog) over that agent's head on frames that already render.
 * Reuses one vector; looks the avatar up by name only when the card's agent changes.
 */
function Projector() {
  const point = useRef(new Vector3());
  const cached = useRef<{ id: string; object: Object3D | undefined } | null>(null);
  useFrame(({ camera, size, scene }) => {
    const card = anchoredCard();
    if (!card) { cached.current = null; return; }
    if (cached.current?.id !== card.agentId) cached.current = { id: card.agentId, object: scene.getObjectByName(`agent:${card.agentId}`) };
    const avatar = cached.current.object;
    const { element } = card;
    if (!avatar) { element.dataset.anchored = 'docked'; return; }
    const p = point.current.setFromMatrixPosition(avatar.matrixWorld);
    p.y = HEAD_Y;
    const distance = p.distanceTo(camera.position);
    p.project(camera);
    const behind = p.z > 1;
    const scale = Math.min(1, Math.max(0.82, 2.6 / Math.max(distance, 0.1)));
    const width = element.offsetWidth * scale, height = element.offsetHeight * scale;
    const rawX = behind ? size.width / 2 : (p.x + 1) * size.width / 2;
    const rawY = behind ? size.height * 0.6 : (1 - p.y) * size.height / 2;
    const x = Math.min(size.width - EDGE - width / 2, Math.max(EDGE + width / 2, rawX));
    const y = Math.min(size.height - EDGE, Math.max(EDGE + height + 14, rawY - 10));
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    // The tail keeps pointing at the head when the card is pushed in from a screen edge.
    element.style.setProperty('--tail-x', `${Math.min(width / scale - 22, Math.max(22, (rawX - x) / scale + width / scale / 2)).toFixed(1)}px`);
    element.dataset.anchored = behind ? 'docked' : 'agent';
  });
  return null;
}

/** HUD variant (c): Play-only scene piece behind the anchored agent card. View-only. */
export function AgentCardAnchor() {
  return usePlayCamera() ? <Projector /> : null;
}
