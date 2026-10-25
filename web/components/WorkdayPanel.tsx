'use client';
import { useEffect, useState } from 'react';
import { pollWorkday } from '../lib/workday/poll';
import { isReplayPage } from '../lib/replay/mode';
import { ROLE_WORK } from '../lib/workday/flow';
import type { HandoffAgentId } from '../lib/office/handoffs';

type Case = { label: string; attack: boolean; status: string; role: HandoffAgentId; steps: { role: HandoffAgentId; status: string }[] };
/** Read-only view of the existing host's case activations; lives inside Office panels. */
export function WorkdayPanel() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [status, setStatus] = useState('ready');
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (isReplayPage()) return;
    let active = true;
    const stop = pollWorkday(1500, async response => {
      if (!active) return;
      if (!response?.ok) { setCases(null); return; }
      const body = await response.json();
      if (active) { setCases(body.cases ?? []); setStatus(body.status); setStale(false); }
    }, () => { if (active) setStale(true); });
    return () => { active = false; stop(); };
  }, []);
  if (!cases) return null;
  return <section className='office-audit' aria-label='Workday'>
    <h2>Workday <span>{stale ? 'Connection lost · last received state' : status}</span></h2>
    <p>Intake → Extractor → Vendor → Payables → Auditor. Payments stay held.</p>
    {!cases.length && <p>Start the workday from the top bar or Inbox.</p>}
    <ol>{cases.map(row => <li key={row.label}>
      <strong>{row.attack ? 'Bank-change email' : row.label}</strong>{' · '}
      {ROLE_WORK[row.role]?.name ?? row.role}: {row.status === 'held' ? 'held for review' : row.status === 'done' ? 'completed' : ROLE_WORK[row.role]?.job ?? row.status}
      <small style={{ display: 'block' }}>{row.steps.map(step => `${ROLE_WORK[step.role]?.name ?? step.role} (${step.status})`).join(' → ')}</small>
    </li>)}</ol>
  </section>;
}
