'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isReplayPage } from '../../../../lib/replay/mode';
import { serverRoomReadout, type Gx10Status } from '../../../../lib/gx10/server-room';

/** GX10 / model router readout (moved out of the 3D scene). Polls only while the Advanced section is open. */
function Gx10Readout({ replay }: { replay: boolean }) {
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
  if (replay) return <p className='office-advanced-note'>Replay · no live GX10 telemetry.</p>;
  const view = serverRoomReadout(status);
  return <section aria-label='Live GX10 server readout' data-testid='gx10-readout' className='office-advanced-gx10'>
    <h3><span className='office-advanced-dot' data-ok={view.connected || undefined} aria-hidden='true' />GX10 · {view.connection}</h3>
    <p className='office-advanced-models'>{view.models}</p>
    <dl>
      <div><dt>Local Share</dt><dd>{view.share}</dd></div>
      <div><dt>Output / Wall Time</dt><dd>{view.speed}</dd></div>
      <div><dt>Request Latency</dt><dd>{view.latency}</dd></div>
      <div><dt>Cloud savings est.</dt><dd>{view.savings}</dd></div>
    </dl>
    <p className='office-advanced-note'>{view.calls}</p>
    <details><summary>Measurement Details</summary>
      <p>{view.calls}. Last 200 HTTP attempts in this server process; includes retries. Throughput includes queue and prefill; last local response within 60 s.</p>
      <p>{view.estimate}. Estimate uses local token counts and router Anthropic rates; excludes electricity and hardware.</p>
      <p>GPU utilization unavailable: no HTTP exporter configured. Cloud fallbacks may send task input off-site.</p>
      <p>Checked {status ? new Date(status.measuredAt).toLocaleTimeString() : '—'}</p>
    </details>
  </section>;
}

/**
 * HUD variant (c): every diagnostic in one collapsed "Advanced" section in the toolbar: connection
 * details, the LLM switch, GX10 / model router stats and measurement details. Closed by default.
 */
export function OfficeAdvanced({ connection, replay, llm }: { connection: string; replay: boolean; llm: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className='office-advanced' open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Advanced</summary>
    <div className='office-advanced-panel'>
      <section aria-label='Connection details'>
        <h3>Connection</h3>
        <p className='connection-status' role='status'>{connection}</p>
      </section>
      <section aria-label='Model control'>
        <h3>Language Models</h3>
        {llm}
      </section>
      {open && <Gx10Readout replay={replay} />}
      <p className='office-advanced-note'><a href='/real-vs-sim'>System status ↗</a></p>
    </div>
  </details>;
}
