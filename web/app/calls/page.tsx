'use client';
import { useState } from 'react';
import { signInOperator } from '../../lib/operator/sign-in-client';
import type { EmailOnlyScenario } from '../../lib/calls/request';
import PaymentLinkPanel from '../../components/PaymentLinkPanel';
import styles from '../approve/[id]/approval.module.css';

type EmailOnlyResult = { ok: boolean; message: string; error?: string; email?: 'queued' | 'duplicate' };
const EMAIL_ONLY_CLIENTS: { scenario: EmailOnlyScenario; label: string }[] = [
  { scenario: 'consumer', label: 'Request call: consumer client' },
  { scenario: 'opt_out', label: 'Request call: opted-out (DNC) client' },
];

/** Operator sign-in, worded for the office desk phone's Request call button. Same session as /operator. */
export default function CallUnlock() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailResult, setEmailResult] = useState<EmailOnlyResult>();
  async function unlock() {
    setBusy(true); setResult(undefined);
    try { setResult({ ok: true, message: await signInOperator(code) }); setCode(''); }
    catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : 'Sign-in failed. Try again.' }); }
    finally { setBusy(false); }
  }
  // The same request route as the desk phone; the body names only a seeded fixture client, never a number.
  async function requestEmailOnly(scenario: EmailOnlyScenario) {
    setEmailBusy(true); setEmailResult(undefined);
    try {
      const response = await fetch('/api/calls/request', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ line: 'collections', scenario }) });
      setEmailResult(await response.json() as EmailOnlyResult);
    } catch { setEmailResult({ ok: false, message: 'The call request did not reach this host. No call placed.' }); }
    finally { setEmailBusy(false); }
  }
  return <main className={styles.page}><div className={styles.sheet}>
    <h1>Office Calls</h1>
    <p className={styles.intro}>Press Request call on the office desk phone to ring the approved number. The agent says it is an AI before anything else.</p>
    {/* Shows only while a call's payment link is live, so nobody needs to know /payment-link. */}
    <PaymentLinkPanel title="Payment link ready" payButton idle={false} />
    {result && <p className={result.ok ? styles.notice : styles.error} role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
    {result?.ok ? <p className={styles.section}><a href="/office">Back to the office</a></p>
      : <form className={styles.section} onSubmit={e => { e.preventDefault(); void unlock(); }}>
        <div className={styles.fields}><label>Operator code<input type="password" autoComplete="off" required value={code} onChange={e => setCode(e.target.value)} /></label></div>
        <p><button className={styles.primary} disabled={busy || !code}>{busy ? 'Unlocking…' : 'Unlock office calls'}</button></p>
      </form>}
    <section className={styles.section} aria-labelledby="email-only-clients">
      <h2 id="email-only-clients">Email-Only Clients</h2>
      <p className={styles.intro}>Clients that policy never lets us phone. Pre-call checks refuse the request before any dial; the Collections planner may queue one follow-up email per invoice per day. Nothing is sent.</p>
      <div className={styles.actions}>
        {EMAIL_ONLY_CLIENTS.map(row => <button key={row.scenario} type="button" className={styles.secondary} disabled={emailBusy}
          onClick={() => void requestEmailOnly(row.scenario)}>{emailBusy ? 'Checking…' : row.label}</button>)}
      </div>
      {emailResult && <p className={emailResult.email ? styles.notice : styles.error} role={emailResult.email ? 'status' : 'alert'}>{emailResult.message}</p>}
      {emailResult?.email && <p>Audit rows: <code>office_call_refused</code> ({emailResult.error}) and <code>email_followup_{emailResult.email}</code>. <a href="/audit">Open the audit wall</a></p>}
    </section>
  </div></main>;
}
