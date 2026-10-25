'use client';
import { useEffect, useState } from 'react';
import { operatorActions, type OperatorAction } from '../../lib/operator/catalog';
import ControllerQr from './ControllerQr';
import PaymentStep from './PaymentStep';
import '../office/lobby.css';
import { signInOperator } from '../../lib/operator/sign-in-client';
import styles from './operator.module.css';

type Receipt = { result?: unknown; error?: string; auditHref?: string; requestId?: string };
type Links = { approvePath?: string; payPath?: string; stateStore?: string; bank?: string; llmEnabled?: boolean; publicUrl?: string };
type X402Receipt = { rail: string; note?: string; scenario: string; status: string; reason?: string; replay?: boolean; vendor?: string; invoiceId?: string; amount?: string;
  asset?: string; recipient?: string; policy?: { decision: string; ruleIds: string[]; reason?: string }; transaction?: string; explorer?: string;
  holdId?: string; proof?: { vendorRequests: number; signatures: number }; paymentAuditHref?: string };
const isX402 = (value: unknown): value is X402Receipt => !!value && typeof value === 'object' && 'rail' in value && typeof value.rail === 'string' && value.rail.startsWith('x402');
function X402Summary({ receipt }: { receipt: X402Receipt }) {
  return <dl className={styles.facts} aria-label='x402 payment result'>
    <dt>Rail</dt><dd><strong>{receipt.rail.toUpperCase()}</strong>{receipt.note && ` · ${receipt.note}`}</dd>
    <dt>Status</dt><dd>{receipt.status}{receipt.replay ? ' (replay of the earlier receipt; nothing paid again)' : ''}{receipt.reason && ` · ${receipt.reason}`}</dd>
    {receipt.amount && <><dt>Amount</dt><dd>{receipt.amount} · {receipt.asset} · {receipt.vendor} invoice {receipt.invoiceId}</dd></>}
    {receipt.recipient && <><dt>Recipient</dt><dd><code>{receipt.recipient}</code> (approved vendor-master wallet)</dd></>}
    {receipt.policy && <><dt>Policy</dt><dd>{receipt.policy.decision}{receipt.policy.ruleIds.length ? ` · ${receipt.policy.ruleIds.join(', ')}` : ''}{receipt.policy.reason && ` · ${receipt.policy.reason}`}</dd></>}
    {receipt.proof && <><dt>Signing</dt><dd>{receipt.proof.signatures} signature{receipt.proof.signatures === 1 ? '' : 's'} · {receipt.proof.vendorRequests} vendor request{receipt.proof.vendorRequests === 1 ? '' : 's'}</dd></>}
    {receipt.transaction && <><dt>Transaction</dt><dd>{receipt.explorer ? <a href={receipt.explorer} target='_blank' rel='noreferrer'>View on Base Sepolia basescan</a>
      : <><code>{receipt.transaction}</code> (simulated hash, not on any chain)</>}</dd></>}
    {receipt.holdId && <><dt>Hold</dt><dd>{receipt.holdId} · held on this console, not paid</dd></>}
    {receipt.paymentAuditHref && <><dt>Audit</dt><dd><a href={receipt.paymentAuditHref}>Open payment audit</a></dd></>}
  </dl>;
}
export default function OperatorPage() {
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    try { setTheme(localStorage.getItem('backroom-theme') === 'dark' ? 'dark' : 'light'); }
    catch { setTheme('light'); }
  }, []);
  const [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState('');
  const [offBusy, setOffBusy] = useState(false), [code, setCode] = useState('');
  const [error, setError] = useState(''), [receipt, setReceipt] = useState<Receipt>();
  const [links, setLinks] = useState<Links>({}), [confirm, setConfirm] = useState<OperatorAction>();
  const [resetDone, setResetDone] = useState(false);
  const [testnet, setTestnet] = useState<{ available: boolean; reason?: string }>();
  async function session() {
    const response = await fetch('/api/operator/session', { cache: 'no-store' }).catch(() => undefined);
    setAuthorized(!!response?.ok);
    if (response?.ok) setTestnet((await response.json() as { x402Testnet?: { available: boolean; reason?: string } }).x402Testnet);
    return !!response?.ok;
  }
  useEffect(() => { void session(); }, []);
  async function signIn() {
    setBusy('session'); setError('');
    try {
      await signInOperator(code); setCode('');
      if (!await session()) throw new Error('Signed in, but this host’s console is unavailable. The audit wall, desk phone and policy editor are unlocked.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { setBusy(''); }
  }
  async function unlock() {
    setBusy('session'); setError('');
    try {
      const response = await fetch('/__operator/session', { method: 'POST' });
      if (!response.ok) throw new Error('Code-free unlock works only at http://127.0.0.1:<demo port>/operator on the host. Use the operator code here instead.');
      await session();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Console unavailable.'); }
    finally { setBusy(''); }
  }
  async function run(action: OperatorAction) {
    const off = action === 'llm_off';
    if (off) setOffBusy(true); else setBusy(action);
    setError(''); setConfirm(undefined);
    try {
      const response = await fetch(`/api/operator/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await response.json() as Receipt;
      setReceipt(data);
      if (response.status === 401) setAuthorized(false);
      if (!response.ok) throw new Error(data.error || 'Action unavailable.');
      if (action === 'status' || action === 'reset') setLinks(data.result as Links);
      if (action === 'reset') setResetDone(true);
      if (action === 'llm_on' || action === 'llm_off') setLinks(current => ({ ...current, ...(data.result as Links) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action unavailable. Check the audit before retrying.'); }
    finally { if (off) setOffBusy(false); else setBusy(''); }
  }
  function trigger(action: OperatorAction, label: string = operatorActions[action][0], primary = false) {
    return <button key={action} className={primary ? styles.primary : undefined} disabled={action === 'llm_off' ? offBusy : !!busy || offBusy || !!unavailable(action)}
      onClick={() => action === 'reset' || action === 'llm_on' || action === 'warm' || action === 'burst' || action === 'x402_testnet' ? setConfirm(action) : void run(action)}>
      {busy === action || action === 'llm_off' && offBusy ? 'Running…' : label}</button>;
  }
  function unavailable(action: OperatorAction) {
    return action === 'x402_testnet' && testnet && !testnet.available ? testnet.reason || 'Testnet is off on this host.' : undefined;
  }
  function button(action: OperatorAction) {
    return <div className={styles.action} key={action}><div><strong>{operatorActions[action][0]}</strong><p>{operatorActions[action][1]}</p></div>{trigger(action)}</div>;
  }
  const controllerUrl = links.publicUrl ? `${links.publicUrl}/controller` : '';
  return <main className={styles.page} data-theme={theme}><div className={styles.content}>
    <header><a href='/office'>Backroom office</a><span className={styles.pill}>Demo · synthetic company · sandbox money</span><a href='/real-vs-sim'>What is real?</a></header>
    <h1>Demo operator</h1>
    <p className={styles.lede}>Run the demo top to bottom. Every action is audited; approvals still need Dana&rsquo;s passkey.</p>
    {error && <p role='alert' className={styles.error}>{error}</p>}
    {!authorized ? <><section className={styles.card}><h2>Operator sign-in</h2><p>One sign-in for the whole demo: this console, the office desk phone&rsquo;s Request call, the audit wall and the policy editor. It expires after eight hours. It never approves a payment; approvals still need Dana&rsquo;s passkey.</p>
      <form className={styles.row} onSubmit={e => { e.preventDefault(); void signIn(); }}>
        <label>Operator code <input type='password' autoComplete='off' required value={code} onChange={e => setCode(e.target.value)} /></label>
        <button className={styles.primary} disabled={!!busy || !code}>{busy === 'session' ? 'Signing in…' : 'Sign in'}</button>
      </form></section>
      <section className={styles.card}><h2>On the host itself</h2><p>At the demo host&rsquo;s numeric loopback address you can unlock this console without the code.</p>
      <button disabled={!!busy} onClick={() => void unlock()}>Unlock local operator session</button></section></> : <>
      <div className={styles.session}><p role='status'>{busy ? `${operatorActions[busy as OperatorAction]?.[0] || 'Working'}…` : offBusy ? 'Turning models OFF…' : 'Operator session active.'}</p>
        <button disabled={!!busy || offBusy} onClick={() => { void fetch('/api/operator/logout', { method: 'POST' }).then(response => { if (response.ok) setAuthorized(false); }); }}>Lock console</button></div>
      {confirm && <section className={styles.card} role='alertdialog' aria-modal='false' aria-labelledby='confirm-title'><h2 id='confirm-title'>{operatorActions[confirm][0]}?</h2><p>{operatorActions[confirm][1]}</p>
        <div className={styles.row}><button className={styles.primary} autoFocus disabled={!!busy || offBusy} onClick={() => void run(confirm)}>Confirm {operatorActions[confirm][0].toLowerCase()}</button><button onClick={() => setConfirm(undefined)}>Cancel</button></div></section>}
      <ol className={styles.steps}>
        <li className={styles.card}><h2>Reset company</h2><p>Fresh run: new database and seeded company. Old links expire.</p>
          <div className={styles.row}>{trigger('reset', 'Reset company', true)}{resetDone && <a href='/office'>Reload the office</a>}</div></li>
        <li className={styles.card}><h2>Start the call</h2><p>In the office, walk to the Collections desk phone and press Request call.</p>
          <div className={styles.row}><a className={styles.cta} href='/office'>Open the office</a></div></li>
        <li className={styles.card}><h2>Dana&rsquo;s controller</h2><p>Dana approves on a phone with a passkey when the plan exceeds the agent&rsquo;s badge.</p>
          {controllerUrl ? <ControllerQr url={controllerUrl} /> : <div className={styles.row}>{trigger('status', 'Show phone QR')}<a href='/controller'>Open controller here</a></div>}</li>
        <li className={styles.card}><h2>Payment link</h2><p>Scan to pay, or use the lobby kiosk. Reconciliation lands on the audit wall.</p><PaymentStep /></li>
        <li className={styles.card} id='operator-x402'><h2>Pay a vendor (x402)</h2><div data-operator-slot='x402'>
          <p>Northfield pays an approved vendor invoice over x402. Policy must allow it; the over-limit invoice is held with zero signatures.</p>
          <div className={styles.row}>{(['x402_simulated', 'x402_blocked', 'x402_testnet'] as const).map(action => trigger(action))}</div>
          {unavailable('x402_testnet') && <p role='note' className={styles.muted}>Unavailable: {unavailable('x402_testnet')}</p>}
          {isX402(receipt?.result) && <X402Summary receipt={receipt.result} />}</div></li>
        <li className={styles.card}><h2>Show the guardrails</h2>
          <nav aria-label='Demo views' className={styles.row}><a href='/inbox'>Inbox</a><a href='/audit'>Audit wall</a><a href='/attack'>Attack demo</a></nav></li>
      </ol>
      <details className={styles.advanced}><summary>Advanced</summary>
        <section><h2>Host and company</h2>{(['status', 'health', 'preflight'] as const).map(button)}
          {(links.approvePath || links.payPath) && <p>{links.approvePath && <a href={`${links.publicUrl || ''}${links.approvePath}`}>Current seeded approval</a>} {' · '}
            {links.payPath && <a href={`${links.publicUrl || ''}${links.payPath}`}>Current seeded payment</a>}</p>}
          {links.stateStore && <p className={styles.muted}>State: {links.stateStore} · Bank: {links.bank} · LLM {links.llmEnabled ? 'ON' : 'OFF'}</p>}
        </section>
        <section><h2>Scenarios and proof</h2><p className={styles.muted}>These runs are isolated from the office. Synthetic calls, bank effects and software authenticators remain labeled in the output.</p>
          {(['core', 'eval', 'metrics', 'scoreboard', 'burst_plan'] as const).map(button)}</section>
        <section><h2>Model controls</h2>{(['llm_off', 'llm_on', 'warm', 'burst'] as const).map(button)}</section>
        <section><h2>Other views</h2><nav aria-label='Other views' className={styles.row}><a href='/controller'>Controller inbox</a><a href='/policy'>Policy editor</a></nav></section>
        {receipt && <section aria-label='Latest action receipt'><h2>Latest receipt</h2>{receipt.auditHref && <p><a href={receipt.auditHref}>Open action audit</a></p>}
          {!!receipt.result && typeof receipt.result === 'object' && 'exitCode' in receipt.result && typeof receipt.result.exitCode === 'number'
            && <p>Exit status: {receipt.result.exitCode} · {receipt.result.exitCode === 0 ? 'passed' : 'failed'}</p>}
          <pre>{receipt.result && typeof receipt.result === 'object' && 'output' in receipt.result && typeof receipt.result.output === 'string'
            ? receipt.result.output : JSON.stringify(receipt, null, 2)}</pre></section>}
      </details>
    </>}
  </div></main>;
}
