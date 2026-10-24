'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { serverRoomReadout, type Gx10Status } from '../../../lib/gx10/server-room';
import { ROLES } from '../../../lib/office/palette';

/** Own the DOM root outside the Canvas reconciler; defer root work past its commit. */
function Readout({ children }: { children: ReactNode }) {
  const gl = useThree(state => state.gl);
  const anchor = useRef<Group>(null);
  const point = useRef(new Vector3());
  const portal = useRef<{ host: HTMLDivElement; root: Root } | null>(null);
  useEffect(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;top:0;left:0;z-index:5;pointer-events:auto';
    gl.domElement.parentElement?.appendChild(host);
    const root = createRoot(host);
    portal.current = { host, root };
    return () => { portal.current = null; host.remove(); queueMicrotask(() => root.unmount()); };
  }, [gl]);
  useEffect(() => {
    const current = portal.current;
    queueMicrotask(() => { if (current && portal.current === current) current.root.render(children); });
  }, [children, gl]);
  useFrame(({ camera, size }) => {
    if (!anchor.current || !portal.current) return;
    anchor.current.getWorldPosition(point.current).project(camera);
    const { x, y, z } = point.current;
    const host = portal.current.host;
    host.style.visibility = Math.abs(x) > 1 || Math.abs(y) > 1 || z < -1 || z > 1 ? 'hidden' : 'visible';
    const left = Math.max(8, Math.min(size.width - 244, (x + 1) * size.width / 2 + 48));
    host.style.transform = `translate(${left}px, ${(1 - y) * size.height / 2}px) translateY(-50%)`;
  });
  return <group ref={anchor} position={[0, 2.7, 0]} />;
}

/** One scene anchor; no camera, Play controls, policy, or state mutations. */
export function ServerRoom({ position = [7.1, 0, -0.8], replay = false }: { position?: [number, number, number]; replay?: boolean }) {
  const [status, setStatus] = useState<Gx10Status | null>(null);
  useEffect(() => {
    // Replay is a recorded projection: never read live telemetry or arm its timer.
    if (replay) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/gx10', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
        if (!response.ok) throw new Error('Telemetry unavailable');
        const next = await response.json() as Gx10Status;
        if (!controller.signal.aborted) setStatus(next);
      } catch { if (!controller.signal.aborted) setStatus(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 2500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [replay]);
  const view = serverRoomReadout(replay ? null : status);
  return <group position={position} name='gx10-server-room'>
    <mesh position={[0, 0.12, 0]} castShadow receiveShadow><boxGeometry args={[1.2, 0.24, 1.05]} /><meshStandardMaterial color={ROLES.desk} /></mesh>
    <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[0.85, 0.8, 0.85]} /><meshStandardMaterial color={ROLES.frame} metalness={0.5} roughness={0.45} /></mesh>
    {Array.from({ length: 5 }, (_, i) => <mesh key={i} position={[0, 0.4 + i * 0.1, 0.43]}><boxGeometry args={[0.6, 0.025, 0.015]} /><meshStandardMaterial color={ROLES.shadow} /></mesh>)}
    <mesh position={[0.29, 0.9, 0.44]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color={view.connected ? ROLES.statusOk : ROLES.statusWarn} /></mesh>
    {!replay && <Readout>
      <section aria-label='Live GX10 server readout' data-testid='gx10-readout' onPointerDown={event => event.stopPropagation()}
        style={{ width: 228, maxHeight: '65vh', overflowY: 'auto', padding: 12, background: ROLES.frame, color: ROLES.wall, border: `1px solid ${ROLES.shadow}`, borderRadius: 4, font: '12px/1.5 monospace', pointerEvents: 'auto' }}>
        <strong style={{ fontSize: 15 }}>GX10 · {view.connection}</strong>
        <div style={{ overflowWrap: 'anywhere', color: ROLES.lampLight, marginBottom: 8 }}>{view.models}</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px', margin: 0 }}>
          <dt>Local share</dt><dd style={{ margin: 0 }}>{view.share}</dd>
          <dt>Output / wall time</dt><dd style={{ margin: 0 }}>{view.speed}</dd>
          <dt>Request latency</dt><dd style={{ margin: 0 }}>{view.latency}</dd>
          <dt>Cloud savings est.</dt><dd style={{ margin: 0 }}>{view.savings}</dd>
        </dl>
        <div style={{ marginTop: 6, fontSize: 11 }}>{view.calls}</div>
        <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }}>Measurement details</summary>
          <p style={{ margin: '6px 0' }}>{view.calls}. Last 200 HTTP attempts in this server process; includes retries. Throughput includes queue and prefill; last local response within 60 s.</p>
          <p style={{ margin: '6px 0' }}>{view.estimate}. Estimate uses local token counts and router Anthropic rates; excludes electricity and hardware.</p>
          <p style={{ margin: '6px 0' }}>GPU utilization unavailable: no HTTP exporter configured. Cloud fallbacks may send task input off-site.</p>
          <div>Checked {status ? new Date(status.measuredAt).toLocaleTimeString() : '—'}</div>
        </details>
      </section>
    </Readout>}
  </group>;
}
