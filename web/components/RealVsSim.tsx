'use client';

import { useEffect, useState } from 'react';
import { isReplayPage } from '../lib/replay/mode';
import { disclosureItems, getDisclosureStatus, LOCAL_LABEL, type DemoStatus, type DisclosureItem } from '../lib/real-vs-sim';
import './RealVsSim.css';

/** Polls /api/demo-status every 10 seconds while enabled; null while unknown or unreachable. */
export function useDemoStatus(enabled = true) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  useEffect(() => {
    if (!enabled || isReplayPage()) return;
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
      <strong>{item.label}</strong>
      <span className={`real-sim-status real-sim-${state.tone}`}>{state.label}</span>
    </div>
    {state.detail && <p className="real-sim-detail-line" title={state.detail}>{state.detail}</p>}
    {detailed && <p>{item.description}</p>}
  </li>;
}

/** Integration status for /real-vs-sim: current evidence for every service the agents touch. */
export function RealVsSim() {
  const status = useDemoStatus();
  const models = status ? (status.llmEnabled ? 'Models on' : 'Models off · model work paused') : 'Live status unavailable';
  return (
    <section className="real-sim-page" aria-label="System status">
      <header className="real-sim-header">
        <div><h1>System Status</h1><p className="real-sim-intro">Current evidence for each service. Refreshes every 10 seconds.</p></div>
        <span className={`real-sim-status ${status?.llmEnabled ? 'real-sim-good' : status ? 'real-sim-warning' : ''}`}>{models}</span>
      </header>
      <div className="real-sim real-sim-detail">
      <div className="real-sim-groups">
        {(['real', 'sandbox'] as const).map(kind => (
          <section key={kind} aria-label={kind === 'real' ? 'Live services' : 'Partner services'}>
            <h2>{kind === 'real' ? 'Live Services' : 'Partner Services'}</h2>
            <ul>
              {disclosureItems.filter(item => item.kind === kind).map(item => <DisclosureRow key={item.id} item={item} status={status} detailed />)}
            </ul>
          </section>
        ))}
      </div>
      <dl className="real-sim-legend" aria-label="Status key">
        <div><dt>Verified</dt><dd>Live check or saved receipt.</dd></div>
        <div><dt>{LOCAL_LABEL}</dt><dd>Runs in this process instead of the provider.</dd></div>
        <div><dt>Unreachable</dt><dd>The check failed.</dd></div>
        <div><dt>Unverified</dt><dd>No fresh evidence.</dd></div>
      </dl>
      </div>
    </section>
  );
}
