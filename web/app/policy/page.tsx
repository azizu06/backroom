'use client';
import { useState } from 'react';
import type { PolicyLimits } from '@backroom/orchestrator';
import type { Policy } from '../../../policy/src/index';
import { BadgeEditor } from '../../components/BadgeEditor';
import styles from './policy.module.css';

const messages: Record<string, string> = {
  POLICY_EDITOR_NOT_CONFIGURED: 'The demo policy editor is not configured on this server.',
  OWNER_PIN_REQUIRED: 'The owner demo PIN did not match.',
  PIN_RATE_LIMITED: 'Too many incorrect PIN attempts. Wait one minute, then try again.',
  POLICY_CONFLICT: 'Another owner saved a newer version. Reload the saved policy before editing again.',
  INVALID_LIMITS: 'Check each numeric limit. Counts, days, and cents must be whole numbers; the percentage must be between 0 and 100.',
};
export default function PolicyPage() {
  const [pin, setPin] = useState(''), [policy, setPolicy] = useState<Policy>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function request(body?: { expectedVersion: number; limits: PolicyLimits }) {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/policy', { method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: { 'x-policy-demo-pin': pin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(messages[data.error] ?? 'The policy could not be loaded or saved. Try again.');
      setPolicy(data.policy); setRevision(value => value + 1);
      if (body) setNotice(`Saved v${data.policy.policyVersion}. New decisions use these limits. Your change is recorded in the audit wall.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The policy request failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><div className={styles.content}>
    <header><a href="/office">Backroom</a><a href="/audit">Audit wall</a></header>
    <h1>Owner policy</h1>
    <p className={styles.intro}>Set the limits each seat may accept. Requests outside a badge still go to Dana.</p>
    <p className={styles.auth}>Demo PIN protection · Owner only. Policy editing is unavailable to agents and voice tools.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!policy ? <form className={styles.unlock} onSubmit={e => { e.preventDefault(); void request(); }}>
      <label>Owner demo PIN<input type="password" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
      <button disabled={busy || !pin}>{busy ? 'Checking…' : 'Unlock policy'}</button>
    </form> : <>
      <div className={styles.toolbar}><strong>Saved policy v{policy.policyVersion}</strong>
        <button disabled={busy} onClick={() => void request()}>Reload saved policy</button>
        <button disabled={busy} onClick={() => { setPin(''); setPolicy(undefined); setNotice(''); setError(''); }}>Lock editor</button></div>
      <BadgeEditor key={revision} policy={policy} busy={busy}
        onSave={limits => request({ expectedVersion: policy.policyVersion, limits })} />
    </>}
    <footer>Northfield Studio · Owner changes are recorded as human actions.</footer>
  </div></main>;
}
