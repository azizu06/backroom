'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import { COURT, newMatch, paddleX, stepMatch } from '../../../lib/office/pingpong/game';
import { PINGPONG_TABLE } from '../../../lib/office/pingpong/table';
import { pingPongSession } from '../../../lib/office/pingpong/session';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { playOfficeCue } from '../../../lib/office/sound-events';
import { requestSceneFrame } from '../../../lib/office/frame';

/** A local arcade game: no backend, policy, model calls or financial state. */
export function PingPong() {
  const active = useSyncExternalStore(pingPongSession.subscribe, pingPongSession.getSnapshot, pingPongSession.getServerSnapshot);
  const game = useRef(newMatch());
  const human = useRef(0);
  const keys = useRef(new Set<string>());
  const ball = useRef<Mesh>(null);
  const player = useRef<Mesh>(null);
  const ai = useRef<Mesh>(null);
  const readout = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState({ player: 0, ai: 0, winner: null as 'player' | 'ai' | null });
  const invalidate = useThree(state => state.invalidate);

  useEffect(() => {
    if (!active) return;
    game.current = newMatch();
    human.current = 0;
    keys.current.clear();
    setScore({ player: 0, ai: 0, winner: null });
    if (document.pointerLockElement) document.exitPointerLock?.();
    invalidate();
    return () => { keys.current.clear(); invalidate(); };
  }, [active, invalidate]);

  useEffect(() => {
    const controls = new Set(['a', 'd', 'w', 's', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'e', 'enter', 'escape']);
    const key = (event: KeyboardEvent) => {
      if (!pingPongSession.getSnapshot() || event.ctrlKey || event.metaKey || event.altKey) return;
      const code = event.key.toLowerCase();
      if (!controls.has(code)) return;
      event.preventDefault();
      event.stopImmediatePropagation(); // The office HUD must not walk or exit Play for these keys.
      if (event.type === 'keyup') { keys.current.delete(code); return; }
      if (code === 'escape') {
        pingPongSession.stop();
        document.querySelector<HTMLElement>('.play-surface')?.focus();
        return;
      }
      if (code === 'enter' && game.current.winner) {
        game.current = newMatch();
        setScore({ player: 0, ai: 0, winner: null });
      }
      keys.current.add(code);
      if (!event.repeat && ['a', 'd', 'arrowleft', 'arrowright'].includes(code)) {
        human.current = paddleX(human.current + (code === 'a' || code === 'arrowleft' ? -0.06 : 0.06));
      }
      requestSceneFrame();
    };
    const mouse = (event: MouseEvent) => {
      if (!pingPongSession.getSnapshot()) return;
      // Match the play surface's canvas viewport, including narrow layouts.
      const bounds = document.querySelector('.play-surface')?.getBoundingClientRect();
      if (!bounds?.width) return;
      human.current = paddleX(((event.clientX - bounds.left) / bounds.width * 2 - 1) * COURT.halfWidth);
      event.stopImmediatePropagation();
      requestSceneFrame();
    };
    const click = (event: MouseEvent) => {
      if (pingPongSession.getSnapshot() && event.target instanceof Element && event.target.closest('.play-surface')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const blur = () => { keys.current.clear(); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('mousemove', mouse, true);
    window.addEventListener('click', click, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('mousemove', mouse, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('blur', blur);
      pingPongSession.stop();
    };
  }, []);

  useFrame((state, delta) => {
    if (!pingPongSession.getSnapshot()) return;
    const dt = Math.min(delta, 0.05);
    const left = keys.current.has('a') || keys.current.has('arrowleft');
    const right = keys.current.has('d') || keys.current.has('arrowright');
    human.current = paddleX(human.current + (Number(right) - Number(left)) * dt * 1.5);
    const next = stepMatch(game.current, dt, human.current);
    game.current = next.state;
    for (const event of next.events) {
      if (event === 'hit') playOfficeCue('pingHit');
      if (event === 'bounce') playOfficeCue('pingBounce');
      if (event === 'point') setScore({ ...next.state.score, winner: next.state.winner });
    }
    const b = next.state.ball;
    ball.current?.position.set(b.x, COURT.height + b.y, b.z);
    if (player.current) player.current.position.x = next.state.player;
    if (ai.current) ai.current.position.x = next.state.ai;
    if (readout.current) {
      readout.current.dataset.paddleX = next.state.player.toFixed(3);
      readout.current.dataset.ballZ = b.z.toFixed(3);
    }
    // Snap both ways: no camera swoop, including with prefers-reduced-motion.
    state.camera.position.set(PINGPONG_TABLE.x + COURT.halfLength + 0.85, 1.8, PINGPONG_TABLE.z);
    state.camera.lookAt(PINGPONG_TABLE.x, COURT.height + 0.15, PINGPONG_TABLE.z);
    state.camera.updateMatrixWorld();
    if (readout.current) readout.current.dataset.cameraX = state.camera.position.x.toFixed(3);
    state.invalidate();
  });

  return <group name='ping-pong'>
    <group position={[PINGPONG_TABLE.x, 0, PINGPONG_TABLE.z]} rotation={[0, PINGPONG_TABLE.rotation, 0]}>
      <mesh position={[0, COURT.height - 0.04, 0]} receiveShadow>
        <boxGeometry args={[COURT.halfWidth * 2, 0.08, COURT.halfLength * 2]} />
        <meshStandardMaterial color={PALETTE.mint} roughness={0.85} />
      </mesh>
      {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}:${z}`} position={[x * 0.5, 0.35, z * 0.88]}>
        <boxGeometry args={[0.07, 0.7, 0.07]} /><meshStandardMaterial color={ROLES.frame} />
      </mesh>))}
      {[-1, 1].map(side => <mesh key={side} position={[side * (COURT.halfWidth - 0.02), COURT.height + 0.002, 0]}>
        <boxGeometry args={[0.025, 0.005, COURT.halfLength * 2]} /><meshStandardMaterial color={PALETTE.cream} />
      </mesh>)}
      <mesh position={[0, COURT.height + 0.002, 0]}>
        <boxGeometry args={[0.015, 0.005, COURT.halfLength * 2]} /><meshStandardMaterial color={PALETTE.cream} />
      </mesh>
      <mesh position={[0, COURT.height + COURT.net / 2, 0]}>
        <boxGeometry args={[COURT.halfWidth * 2 + 0.08, COURT.net, 0.015]} />
        <meshStandardMaterial color={ROLES.frame} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, COURT.height + COURT.net, 0]}>
        <boxGeometry args={[COURT.halfWidth * 2 + 0.08, 0.015, 0.02]} /><meshStandardMaterial color={PALETTE.cream} />
      </mesh>
      <mesh ref={player} position={[0, COURT.height + 0.25, COURT.halfLength]}>
        <boxGeometry args={[COURT.paddle * 2, 0.32, 0.045]} /><meshStandardMaterial color={PALETTE.coral} />
      </mesh>
      <mesh ref={ai} position={[0, COURT.height + 0.25, -COURT.halfLength]}>
        <boxGeometry args={[COURT.paddle * 2, 0.32, 0.045]} /><meshStandardMaterial color={PALETTE.lavender} />
      </mesh>
      <mesh ref={ball} position={[0, COURT.height + 0.24, -COURT.halfLength]}>
        <sphereGeometry args={[COURT.radius, 12, 8]} /><meshStandardMaterial color={PALETTE.butter} />
      </mesh>
    </group>
    <Html center position={[PINGPONG_TABLE.x, 1.75, PINGPONG_TABLE.z]} distanceFactor={3} style={{ pointerEvents: 'none' }}>
      <div ref={readout} data-testid='pingpong-score' data-active={String(active)} style={{ color: ROLES.text, background: PALETTE.cream, border: `1px solid ${ROLES.frame}`, borderRadius: 6, padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: 13 }}>
        <strong>Ping pong · You {score.player} : {score.ai} AI</strong>
        <div>{active ? score.winner ? `${score.winner === 'player' ? 'You win!' : 'AI wins'} · Enter: rematch · Esc: leave` : 'Mouse or A/D · First to 5 · Esc: leave' : 'E to play · First to 5'}</div>
      </div>
    </Html>
  </group>;
}
