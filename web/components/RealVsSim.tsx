'use client';

import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { disclosureItems, getDisclosureStatus, NARROW_PANEL_QUERY, panelExpanded, toggledPanel, type DemoStatus, type DisclosureItem } from '../lib/real-vs-sim';
import './RealVsSim.css';

function useMediaQuery(query: string, serverValue: boolean) {
  return useSyncExternalStore(onChange => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, () => window.matchMedia(query).matches, () => serverValue);
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

export function RealVsSim(props: { detailed?: boolean }) {
  return <Suspense fallback={null}><RealVsSimContent {...props} /></Suspense>;
}
function RealVsSimContent({ detailed = false }: { detailed?: boolean }) {
  const pathname = usePathname();
  const replayRequested = useSearchParams().has('replay');
  const replay = replayRequested && (pathname === '/office' || pathname === '/audit');
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(280);
  const hidden = !detailed && pathname === '/real-vs-sim';
  const officeView = pathname === '/' || pathname.startsWith('/office');
  // Server renders docked so phones never paint the panel over office controls before hydration.
  const officeFlows = useMediaQuery('(max-width: 1100px)', true);
  const narrow = useMediaQuery(NARROW_PANEL_QUERY, false);
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = panelExpanded({ detailed, narrow, officeView, userExpanded });
  const bodyId = useId();

  useEffect(() => {
    if (hidden || replay || detailed || !panel.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPanelHeight(entry.target.getBoundingClientRect().height + 24);
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [hidden, detailed, replay]);

  useEffect(() => {
    if (hidden || replay) return;
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
  }, [hidden, replay]);

  if (replay) return <aside aria-label="Replay disclosure" style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 110,
    maxWidth: 'calc(100vw - 48px)', padding: '10px 14px', background: '#302e24', color: '#f0d6a7',
    border: '2px solid #d9af65', font: '13px/1.4 Avenir, sans-serif' }}>
    <strong>REPLAY</strong> · saved synthetic run · no live call or money movement
  </aside>;
  if (hidden) return null;
  return (
    <>
    {!detailed && !officeView && <div aria-hidden="true" style={{ height: panelHeight, background: '#1c1c1e' }} />}
    <aside ref={panel} className={`real-sim ${detailed ? 'real-sim-detail' : `real-sim-overlay${officeView && officeFlows ? ' real-sim-docked' : ''}`}`} data-expanded={expanded} aria-label="Real versus simulated disclosure">
      <header className="real-sim-header">
        {detailed ? <h1>Real vs. simulated</h1> : <h2>Real vs. simulated</h2>}
        {!detailed && <div className="real-sim-actions">
          {(!officeView || expanded) && <a href="/real-vs-sim">Details ↗</a>}
          <button type="button" className="real-sim-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setUserExpanded(toggledPanel(expanded))}>
            {expanded ? 'Hide' : 'Show'}<span className="real-sim-visually-hidden"> real versus simulated status</span>
          </button>
        </div>}
      </header>
      <div id={bodyId} hidden={!expanded}>
      {detailed && <p className="real-sim-intro">A real integration can be offline. Status describes current evidence, not a successful end-to-end demo.</p>}
      <div className="real-sim-groups">
        {(['real', 'sandbox'] as const).map(kind => (
          <section key={kind} aria-label={kind === 'real' ? 'Real integrations' : 'Sandbox and simulated'}>
            <h3>{kind === 'real' ? 'Real' : 'Sandbox / simulated'}</h3>
            <ul>
              {disclosureItems.filter(item => item.kind === kind).map(item => <DisclosureRow key={item.id} item={item} status={status} detailed={detailed} />)}
            </ul>
          </section>
        ))}
      </div>
      </div>
      {/* The sandbox disclosure stays visible even while the office overlay is collapsed. */}
      <p className="real-sim-note">{status ? (status.llmEnabled ? 'LLM enabled' : 'LLM OFF · model work paused') : 'Live status unavailable'} · Sandbox items never represent real money or identities.</p>
      {detailed && <p className="real-sim-note">Status refreshes every 10 seconds; service probes are cached for about 45 seconds. Verified means a fresh live probe or a committed receipt (its time is shown). Simulated means a fixture stands in for the service. Unreachable means the probe failed. Unverified means no fresh evidence is available. LLM control reflects this server process; separate processes need the shared state adapter.</p>}
    </aside>
    </>
  );
}
