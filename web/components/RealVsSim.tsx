'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { disclosureItems, getDisclosureStatus, type DemoStatus } from '../lib/real-vs-sim';
import './RealVsSim.css';

export function RealVsSim({ detailed = false }: { detailed?: boolean }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(280);
  const hidden = !detailed && pathname === '/real-vs-sim';

  useEffect(() => {
    if (hidden || detailed || !panel.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPanelHeight(entry.target.getBoundingClientRect().height + 24);
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [hidden, detailed]);

  useEffect(() => {
    if (hidden) return;
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
  }, [hidden]);

  if (hidden) return null;
  return (
    <>
    {!detailed && pathname !== '/' && !pathname.startsWith('/office') && <div aria-hidden="true" style={{ height: panelHeight, background: '#1c1c1e' }} />}
    <aside ref={panel} className={`real-sim ${detailed ? 'real-sim-detail' : 'real-sim-overlay'}`} aria-label="Real versus simulated disclosure">
      <header className="real-sim-header">
        {detailed ? <h1>Real vs. simulated</h1> : <h2>Real vs. simulated</h2>}
        {!detailed && <a href="/real-vs-sim">Details ↗</a>}
      </header>
      {detailed && <p className="real-sim-intro">A real integration can be offline. Status describes current evidence, not a successful end-to-end demo.</p>}
      <div className="real-sim-groups">
        {(['real', 'sandbox'] as const).map(kind => (
          <section key={kind} aria-label={kind === 'real' ? 'Real integrations' : 'Sandbox and simulated'}>
            <h3>{kind === 'real' ? 'Real' : 'Sandbox / simulated'}</h3>
            <ul>
              {disclosureItems.filter(item => item.kind === kind).map(item => {
                const state = getDisclosureStatus(item, status);
                return <li key={item.id}>
                  <div className="real-sim-row">
                    <span>{item.label}</span>
                    <span className={`real-sim-status real-sim-${state.tone}`}>{state.label}</span>
                  </div>
                  {detailed && <p>{item.description}</p>}
                </li>;
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="real-sim-note">{status ? (status.llmEnabled ? 'LLM enabled' : 'LLM OFF · model work paused') : 'Live status unavailable'} · Sandbox items never represent real money or identities.</p>
      {detailed && <p className="real-sim-note">Status refreshes every 10 seconds. GX10 health and LLM control reflect this server process; separate processes need the shared state adapter. Unverified means no fresh observation is available.</p>}
    </aside>
    </>
  );
}
