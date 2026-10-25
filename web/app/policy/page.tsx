'use client';
import { useEffect, useState } from 'react';
import type { PolicyLimits } from '@backroom/orchestrator';
import type { Policy } from '../../../policy/src/index';
import { BadgeEditor } from '../../components/BadgeEditor';
import { jsonObject, NETWORK_MESSAGE, outageMessage, serverError } from '../../lib/http/response';
import { signInOperator } from '../../lib/operator/sign-in-client';
import styles from './policy.module.css';

const messages: Record<string, string> = {
  POLICY_EDITOR_NOT_CONFIGURED: 'The demo policy editor is not configured on this server.',
  OWNER_PIN_REQUIRED: 'The owner demo PIN did not match.',
  PIN_RATE_LIMITED: 'Too many incorrect PIN attempts. Wait one minute, then try again.',
  POLICY_CONFLICT: 'Another owner saved a newer version. Reload the saved policy before editing again.',
  INVALID_LIMITS: 'Check each numeric limit. Counts, days, and cents must be whole numbers; the percentage must be between 0 and 100.',
};
export default function PolicyPage() {
  const [pin, setPin] = useState(''), [code, setCode] = useState(''), [policy, setPolicy] = useState<Policy>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  // A signed-in operator opens the editor straight away; otherwise stay quietly locked.
  async function probe() {
    const res = await fetch('/api/policy', { cache: 'no-store' }).catch(() => undefined);
    const saved = res?.ok ? (await jsonObject(res))?.policy as Policy | undefined : undefined;
    if (saved && typeof saved.policyVersion === 'number') { setPolicy(saved); setRevision(value => value + 1); return true; }
    return false;
  }
  useEffect(() => { void probe(); }, []);
  async function signIn() {
    setBusy(true); setError(''); setNotice('');
    try {
      await signInOperator(code); setCode('');
      if (!await probe()) throw new Error('Signed in, but the policy could not be loaded. Try again.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed. Try again.'); }
    finally { setBusy(false); }
  }
  async function request(body?: { expectedVersion: number; limits: PolicyLimits }) {
    setBusy(true); setError(''); setNotice('');
    try {
      let res: Response;
      try {
        res = await fetch('/api/policy', { method: body ? 'POST' : 'GET', cache: 'no-store',
          headers: { ...(pin ? { 'x-policy-demo-pin': pin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch { throw new Error(NETWORK_MESSAGE); }
      const data = await jsonObject(res);
      if (!data) throw new Error(outageMessage(res.status));
      const code = serverError(data);
      if (!res.ok) throw new Error(code !== undefined && Object.prototype.hasOwnProperty.call(messages, code)
        ? messages[code] : 'The policy could not be loaded or saved. Try again.');
      const saved = data.policy as Policy | undefined;
      if (!saved || typeof saved.policyVersion !== 'number') throw new Error('The policy could not be loaded or saved. Try again.');
      setPolicy(saved); setRevision(value => value + 1);
      if (body) setNotice(`Saved v${saved.policyVersion}. New decisions use these limits. Your change is recorded in the audit wall.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The policy request failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><div className={styles.content}>
    <h1>Owner policy</h1>
    <p className={styles.intro}>Set the limits each seat may accept. Requests outside a badge still go to Dana.</p>
    <p className={styles.auth}>Unlock with the operator code or the owner PIN. Agents and voice tools can never edit policy.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!policy ? <>
      <form className={styles.unlock} onSubmit={e => { e.preventDefault(); void signIn(); }}>
        <label>Operator code<input type="password" autoComplete="off" required value={code} onChange={e => setCode(e.target.value)} /></label>
        <button disabled={busy || !code}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
      <form className={styles.unlock} onSubmit={e => { e.preventDefault(); void request(); }}>
        <label>Owner demo PIN<input type="password" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
        <button disabled={busy || !pin}>{busy ? 'Checking…' : 'Unlock policy'}</button>
      </form>
    </> : <>
      <div className={styles.toolbar}><strong>Saved policy v{policy.policyVersion}</strong>
        <button disabled={busy} onClick={() => void request()}>Reload saved policy</button>
        <button disabled={busy} onClick={() => { setPin(''); setPolicy(undefined); setNotice(''); setError(''); }}>Lock editor</button></div>
      <BadgeEditor key={revision} policy={policy} busy={busy}
        onSave={limits => request({ expectedVersion: policy.policyVersion, limits })} />
    </>}
    <footer>Northfield Studio · Owner changes are recorded as human actions.</footer>
  </div></main>;
}
