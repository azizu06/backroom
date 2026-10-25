'use client';

import { useEffect, useState } from 'react';
import { isReplayPage } from '../../../lib/replay/mode';
import { serverRoomReadout, type Gx10Status } from '../../../lib/gx10/server-room';
import { ROLES } from '../../../lib/office/palette';

/** One scene anchor; no camera, Play controls, policy, or state mutations. */
export function ServerRoom({ position = [10.9, 0, -0.8], replay = false }: { position?: [number, number, number]; replay?: boolean }) {
  const [status, setStatus] = useState<Gx10Status | null>(null);
  useEffect(() => {
    // Replay is a recorded projection: never read live telemetry or arm its timer.
    if (replay || isReplayPage()) return;
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
    {/* HUD variant (c): the readout lives in the toolbar's Advanced section (hud/diegetic/OfficeAdvanced). */}
  </group>;
}
