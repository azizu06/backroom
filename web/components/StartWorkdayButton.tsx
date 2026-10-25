'use client';
import { useEffect, useState } from 'react';
import { isReplayPage } from '../lib/replay/mode';

/** Both placements share the operator-only endpoint and its per-reset batch claim. */
export function StartWorkdayButton() {
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (isReplayPage()) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/operator/workday', { cache: 'no-store' });
        if (!active) return;
        setAuthorized(response.ok);
        if (response.ok) {
          const body = await response.json();
          if (active && typeof body.message === 'string' && body.status !== 'ready') setMessage(body.message);
        }
      } catch { /* A failed poll cannot start a batch or claim success. */ }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (!authorized) return null;
  async function start() {
    setBusy(true);
    try {
      const response = await fetch('/api/operator/workday', { method: 'POST', cache: 'no-store' });
      const body = await response.json();
      setMessage(body.message || body.error || 'Workday unavailable. Try again.');
      if (response.status === 401 || response.status === 403) setAuthorized(false);
    } catch { setMessage('Could not reach the workday host. Check its status before trying again.'); }
    finally { setBusy(false); }
  }
  return <span className='workday-control' style={{ display: 'inline-block', marginBlock: 12 }}>
    <button type='button' disabled={busy} onClick={() => { void start(); }} title='Three seeded invoices and a bank-change attack through real agents. No payments.'>Start the workday</button>
    {message && <small role='status' style={{ display: 'block', maxWidth: '32rem' }}>{message}</small>}
  </span>;
}
