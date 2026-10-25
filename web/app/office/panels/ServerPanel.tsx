'use client';

import { useEffect, useState } from 'react';
import { isReplayPage } from '../../../lib/replay/mode';
import { serverRoomReadout, type Gx10Status } from '../../../lib/gx10/server-room';
import type { PlayPanelView } from './types';

/** Read-only GX10 readout: polls GET /api/gx10 only while open, like ServerRoom. */
function ServerPanel() {
  const [status, setStatus] = useState<Gx10Status | null>(null);
  useEffect(() => {
    if (isReplayPage()) return;
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
  }, []);
  const view = serverRoomReadout(status);
  return <>
    <p className='play-panel-state'>{view.connection}</p>
    <p>Read-only · live telemetry, no controls.</p>
    <dl aria-label='GX10 telemetry'>
      <div><dt>Loaded models</dt><dd>{view.models}</dd></div>
      <div><dt>Output tokens/s</dt><dd data-testid='play-gx10-speed'>{view.speed}</dd></div>
      <div><dt>Request latency</dt><dd>{view.latency}</dd></div>
      <div><dt>Local share</dt><dd>{view.share}</dd></div>
    </dl>
    <p>{view.calls}</p>
  </>;
}

export const serverPanel: PlayPanelView = {
  hideAudit: true,
  hideAskWhy: true,
  Body: ServerPanel,
};
