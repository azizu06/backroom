'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Camera, type Mesh } from 'three';
import { COURT, newMatch, paddleX, stepMatchInPlace, type GameEvent } from '../../../lib/office/pingpong/game';
import { PINGPONG_TABLE } from '../../../lib/office/pingpong/table';
import { pingPongSession } from '../../../lib/office/pingpong/session';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { playOfficeCue } from '../../../lib/office/sound-events';
import { requestSceneFrame } from '../../../lib/office/frame';
import { sightBlocked } from '../../../lib/office/layout';

/** A local arcade game: no backend, policy, model calls or financial state. */
export function PingPong() {
  const active = useSyncExternalStore(pingPongSession.subscribe, pingPongSession.getSnapshot, pingPongSession.getServerSnapshot);
  const game = useRef(newMatch());
  const events = useRef<GameEvent[]>([]);
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
    const match = game.current;
    stepMatchInPlace(match, dt, human.current, events.current);
    for (const event of events.current) {
      if (event === 'hit') playOfficeCue('pingHit');
      if (event === 'bounce') playOfficeCue('pingBounce');
      if (event === 'point') setScore({ ...match.score, winner: match.winner });
    }
    const b = match.ball;
    ball.current?.position.set(b.x, COURT.height + b.y, b.z);
    if (player.current) player.current.position.x = match.player;
    if (ai.current) ai.current.position.x = match.ai;
    if (readout.current) {
      readout.current.dataset.paddleX = match.player.toFixed(3);
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
    <ScoreCard readout={readout}>
      <div ref={readout} data-testid='pingpong-score' data-active={String(active)} style={{ color: ROLES.text, background: PALETTE.cream, border: `1px solid ${ROLES.frame}`, borderRadius: 6, padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: 13 }}>
        <strong>Ping pong · You {score.player} : {score.ai} AI</strong>
        <div>{active ? score.winner ? `${score.winner === 'player' ? 'You win!' : 'AI wins'} · Enter: rematch · Esc: leave` : 'Mouse or A/D · First to 5 · Esc: leave' : 'E to play · First to 5'}</div>
      </div>
    </ScoreCard>
  </group>;
}

const CARD_ANCHOR = new Vector3(PINGPONG_TABLE.x, 1.75, PINGPONG_TABLE.z);

/**
 * In-world score card. Like the GX10 readout it owns a DOM root outside the Canvas reconciler and defers
 * root work past its commit (drei Html's inner root does not render here). Placement reuses one vector.
 */
function ScoreCard({ readout, children }: { readout: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const gl = useThree(state => state.gl);
  const get = useThree(state => state.get);
  const portal = useRef<{ host: HTMLDivElement; root: Root } | null>(null);
  const point = useRef(new Vector3());
  const last = useRef({ left: NaN, top: NaN });
  useEffect(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;top:0;left:0;z-index:5;pointer-events:none';
    gl.domElement.parentElement?.appendChild(host);
    const root = createRoot(host);
    portal.current = { host, root };
    return () => { portal.current = null; host.remove(); queueMicrotask(() => root.unmount()); };
  }, [gl]);
  useEffect(() => {
    const current = portal.current;
    queueMicrotask(() => { if (current && portal.current === current) current.root.render(children); });
  }, [children, gl]);
  const place = (camera: Camera, width: number, height: number) => {
    const host = portal.current?.host;
    if (!host) return;
    // First person: a wall between the eye and the table hides the card (the overview sees over cut-away walls).
    const blocked = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true
      && sightBlocked(camera.position.x, camera.position.z, PINGPONG_TABLE.x, PINGPONG_TABLE.z);
    const p = point.current.copy(CARD_ANCHOR).project(camera);
    const hidden = blocked || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1;
    if (readout.current) readout.current.style.visibility = hidden ? 'hidden' : 'visible';
    if (hidden) return;
    // Only touch the transform when the card actually moved, so an idle or steady view builds no strings.
    const left = Math.round((p.x + 1) * width / 2), top = Math.round((1 - p.y) * height / 2);
    if (left === last.current.left && top === last.current.top) return;
    last.current.left = left; last.current.top = top;
    host.style.transform = `translate(${left}px, ${top}px) translate(-50%, -50%)`;
  };
  useFrame(({ camera, size }) => place(camera, size.width, size.height));
  useEffect(() => {
    // A low-rate check also catches camera changes after the demand-rendered scene goes idle.
    const timer = window.setInterval(() => { const { camera, size } = get(); place(camera, size.width, size.height); }, 100);
    return () => window.clearInterval(timer);
  }, [get]); // eslint-disable-line react-hooks/exhaustive-deps -- place only reads refs
  return null;
}
