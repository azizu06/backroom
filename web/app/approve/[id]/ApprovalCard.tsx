'use client';
import { useCallback, useEffect, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { ControllerDecision, Escalation } from '@backroom/orchestrator';
import { ApprovalError, approvalRequest } from '../../../lib/approvals/client';
import styles from './approval.module.css';

/** `embedded` drops the page chrome so the live controller inbox can raise the same card in place. */
export default function ApprovalCard({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const [row, setRow] = useState<Escalation>();
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [counter, setCounter] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [terms, setTerms] = useState({ installments: 2, firstPaymentPct: 50, durationDays: 30 });
  const base = `/api/approvals/${encodeURIComponent(id)}`;
  // Poll failures are kept apart from decision errors so a recovered poll can clear its own banner.
  const [pollError, setPollError] = useState('');
  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    const data = await approvalRequest(`${base}/view`);
    if (!isActive()) return;
    setRow(data.escalation); setRegistered(data.registered);
    setSeconds(Math.max(0, Math.ceil((data.escalation.expiresAt - Date.now()) / 1000)));
  }, [base]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time: the next poll is scheduled only after the last one settles.
    const poll = async () => {
      try {
        await refresh(() => active);
        if (active) setPollError('');
      } catch (e) {
        if (!active) return;
        // A link that matches no request will not start matching later: stop polling.
        if (e instanceof ApprovalError && e.code === 'ESCALATION_NOT_FOUND') { active = false; setMissing(true); return; }
        setPollError(e instanceof Error ? e.message : 'This request could not be loaded. Try again.');
      }
      if (active) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);
  const decide = async (decision: ControllerDecision) => {
    setBusy(true); setError('');
    try {
      const { options, challengeId } = await approvalRequest(`${base}/options`, { decision });
      const response = await startAuthentication({ optionsJSON: options });
      const data = await approvalRequest(`${base}/decide`, { challengeId, response });
      setRow(data.escalation); setCounter(false);
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Passkey confirmation was canceled. Your decision has not been saved.'
        : e instanceof Error ? e.message : 'Try again with Dana’s passkey.');
      void refresh().catch(() => undefined);
    } finally { setBusy(false); }
  };
  const money = (cents?: number) => cents === undefined ? 'Amount not provided'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: row?.currency ?? 'USD' }).format(cents / 100);
  const closed = row && row.status !== 'pending';
  const canDecide = !!row && !closed && seconds > 0 && registered && !busy;
  const shownError = error || pollError;
  const status = missing ? 'Request not found' : !row && shownError ? 'Request unavailable' : !row ? 'Loading request' : row.status === 'expired' ? 'Request expired' : row.status === 'pending_owner' ? 'Follow-up needed'
    : row.status === 'pending' ? `Client waiting · ${seconds}s` : `Dana ${row.status === 'counter' ? 'countered' : row.status}`;
  const body = <>
      <p className={styles.status} role="status">{busy ? 'Confirm with your passkey…' : status}</p>
      {embedded ? <h2 className={styles.cardTitle}>Approval needed</h2> : <h1>{missing ? 'Nothing to review.' : 'Approval needed'}</h1>}
      {!missing && <p className={styles.intro}>The collections clerk needs your review before agreeing to these terms.</p>}
      {missing ? <section className={styles.result}>
        <h2>This approval link does not match a request.</h2>
        <p>Nothing was approved or denied. Open the latest link from the clerk, or check the audit wall for the escalation.</p>
        <p><a href="/audit">Open the audit wall</a></p>
      </section> : shownError && <div className={styles.error} role="alert">{shownError}<button onClick={() => { setError(''); setPollError(''); void refresh().catch(e => setError(e instanceof Error ? e.message : 'This request could not be loaded. Try again.')); }}>Refresh request</button></div>}
      {row && <>
        <section className={styles.amount} aria-label="Invoice amount">
          <span>{row.invoiceId ? `Invoice ${row.invoiceId}` : row.taskId}</span>
          <strong>{money(row.amountCents)}</strong>
          {row.lateFeeCents !== undefined && <span>Includes {money(row.lateFeeCents)} late fee</span>}
        </section>
        <section className={styles.section}>
          <h2>Requested terms</h2>
          {row.requestedTerms ? <>
            <dl className={styles.terms}>
              <div><dt>Payments</dt><dd>{row.requestedTerms.installments}</dd></div>
              <div><dt>First payment</dt><dd>{row.requestedTerms.firstPaymentPct}%</dd></div>
              <div><dt>Within</dt><dd>{row.requestedTerms.durationDays} days</dd></div>
            </dl>
            <p className={styles.note}>{row.requestedTerms.waiveFee ? 'Late fee waiver requested' : 'Late fee retained'} · {row.requestedTerms.discountPct}% discount</p>
          </> : <p>Review the evidence below before deciding.</p>}
        </section>
        <section className={styles.section}>
          <h2>Why the clerk stopped</h2>
          <div className={styles.rules}>{row.ruleIds.map(rule => <code key={rule}>{rule}</code>)}</div>
          <blockquote>“{row.quote.text}”<cite>{row.quote.sentenceId} · Policy v{row.policyVersion}</cite></blockquote>
          <details><summary>Evidence references</summary><ul>{row.evidenceRefs.map(ref => <li key={ref}>{ref}</li>)}</ul></details>
        </section>
        {closed ? <section className={styles.result} aria-live="polite">
          <h2>{row.status === 'pending_owner' ? 'Dana will confirm by email today.' : row.status === 'expired' ? 'This request expired.' : 'Your decision is recorded.'}</h2>
          <p>{row.method === 'passkey' ? 'Confirmed with Dana’s passkey. The clerk can now relay your decision on the call.' : row.status === 'expired' ? 'No terms were approved.' : 'The review window ended. No terms were approved.'}</p>
          {row.decision?.kind === 'Counter' && <p>{row.decision.terms.installments} payments · {row.decision.terms.firstPaymentPct}% first · {row.decision.terms.durationDays} days</p>}
        </section> : <section className={styles.section}>
          {!registered && <p className={styles.error}>Dana’s passkey is not set up. <a href="/controller">Set up the controller passkey</a> before reviewing requests.</p>}
          {counter ? <form onSubmit={e => { e.preventDefault(); void decide({ kind: 'Counter', terms: { ...terms, waiveFee: false, discountPct: 0 } }); }}>
            <h2>Your counteroffer</h2>
            <div className={styles.fields}>
              <label>Payments<input type="number" min="1" max="100" required value={terms.installments} onChange={e => setTerms({ ...terms, installments: Number(e.target.value) })} /></label>
              <label>First payment (%)<input type="number" min="0" max="100" required value={terms.firstPaymentPct} onChange={e => setTerms({ ...terms, firstPaymentPct: Number(e.target.value) })} /></label>
              <label>Within (days)<input type="number" min="0" max="3650" required value={terms.durationDays} onChange={e => setTerms({ ...terms, durationDays: Number(e.target.value) })} /></label>
            </div>
            <p className={styles.note}>Late fee retained · no discount</p>
            <button className={styles.primary} disabled={!canDecide}>Confirm counter with passkey</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setCounter(false)}>Cancel counter</button>
          </form> : <div className={styles.actions}>
            <button className={styles.primary} disabled={!canDecide} onClick={() => void decide({ kind: 'Approve' })}>Approve with passkey</button>
            <button className={styles.deny} disabled={!canDecide} onClick={() => void decide({ kind: 'Deny' })}>Deny with passkey</button>
            {row.requestedTerms && <button className={styles.secondary} disabled={!canDecide} onClick={() => setCounter(true)}>Offer a counter</button>}
          </div>}
          <p className={styles.note}>Only you can authorize this decision. Spoken instructions cannot approve it.</p>
        </section>}
      </>}
  </>;
  return embedded ? <article className={styles.card} aria-label="Approval request">{body}</article> : <main className={styles.page}>
    <div className={styles.sheet}>
      {body}
      <footer className={styles.footer}>Northfield Studio · Controller review</footer>
    </div>
  </main>;
}
