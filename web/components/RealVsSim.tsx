'use client';

import { useEffect, useState } from 'react';
import { disclosureItems, getDisclosureStatus, type DemoStatus, type DisclosureItem } from '../lib/real-vs-sim';
import './RealVsSim.css';

/** Polls /api/demo-status every 10 seconds while enabled; null while unknown or unreachable. */
export function useDemoStatus(enabled = true) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/demo-status', {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
        if (!response.ok) throw new Error('Status unavailable');
        const next = await response.json() as DemoStatus;
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(null);
      } finally {
        if (active) timer = setTimeout(refresh, 10_000);
      }
    }
    void refresh();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [enabled]);
  return status;
}

export function DisclosureRow({ item, status, detailed, now }: { item: DisclosureItem; status: DemoStatus | null; detailed: boolean; now?: number }) {
  const state = getDisclosureStatus(item, status, now);
  return <li>
    <div className="real-sim-row">
      <span>{item.label}</span>
      <span className={`real-sim-status real-sim-${state.tone}`}>{state.label}</span>
    </div>
    {state.detail && <p className="real-sim-detail-line" title={state.detail}>{state.detail}</p>}
    {detailed && <p>{item.description}</p>}
  </li>;
}

/** Full real-vs-simulated breakdown for /real-vs-sim. Other pages show only the DemoPill. */
export function RealVsSim() {
  const status = useDemoStatus();
  return (
    <section className="real-sim real-sim-detail" aria-label="Real versus simulated disclosure">
      <header className="real-sim-header"><h1>Real vs. simulated</h1></header>
      <p className="real-sim-intro">A real integration can be offline. Status describes current evidence, not a successful end-to-end demo.</p>
      <div className="real-sim-groups">
        {(['real', 'sandbox'] as const).map(kind => (
          <section key={kind} aria-label={kind === 'real' ? 'Real integrations' : 'Sandbox and simulated'}>
            <h3>{kind === 'real' ? 'Real' : 'Sandbox / simulated'}</h3>
            <ul>
              {disclosureItems.filter(item => item.kind === kind).map(item => <DisclosureRow key={item.id} item={item} status={status} detailed />)}
            </ul>
          </section>
        ))}
      </div>
      <p className="real-sim-note">{status ? (status.llmEnabled ? 'LLM enabled' : 'LLM OFF · model work paused') : 'Live status unavailable'} · Sandbox items never represent real money or identities.</p>
      <p className="real-sim-note">Verified: a fresh live check or a saved receipt (time shown). Simulated: a stand-in replaces the service. Unreachable: the check failed. Unverified: no fresh evidence yet. Refreshes every 10 seconds.</p>
    </section>
  );
}
