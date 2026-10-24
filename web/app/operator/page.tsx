'use client';
import { useEffect, useState } from 'react';
import PaymentLinkPanel from '../../components/PaymentLinkPanel';
import { operatorActions, type OperatorAction } from '../../lib/operator/catalog';
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
  const [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState('');
  const [offBusy, setOffBusy] = useState(false);
  const [error, setError] = useState(''), [receipt, setReceipt] = useState<Receipt>();
  const [links, setLinks] = useState<Links>({}), [confirm, setConfirm] = useState<OperatorAction>();
  const [testnet, setTestnet] = useState<{ available: boolean; reason?: string }>();
  async function session() {
    const response = await fetch('/api/operator/session', { cache: 'no-store' });
    setAuthorized(response.ok);
    if (response.ok) setTestnet((await response.json() as { x402Testnet?: { available: boolean; reason?: string } }).x402Testnet);
  }
  useEffect(() => { void session(); }, []);
  async function unlock() {
    setBusy('session'); setError('');
    try {
      const response = await fetch('/__operator/session', { method: 'POST' });
      if (!response.ok) throw new Error('Unlock is available only at http://127.0.0.1:<demo port>/operator on the host. Public links cannot unlock controls.');
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
      if (action === 'llm_on' || action === 'llm_off') setLinks(current => ({ ...current, ...(data.result as Links) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action unavailable. Check the audit before retrying.'); }
    finally { if (off) setOffBusy(false); else setBusy(''); }
  }
  function button(action: OperatorAction) {
    const [label, detail] = operatorActions[action];
    const unavailable = action === 'x402_testnet' && testnet && !testnet.available ? testnet.reason || 'Testnet is off on this host.' : undefined;
    return <div className={styles.action} key={action}><div><strong>{label}</strong><p>{detail}</p>{unavailable && <p role='note'>Unavailable: {unavailable}</p>}</div>
      <button disabled={action === 'llm_off' ? offBusy : !!busy || offBusy || !!unavailable} onClick={() => action === 'reset' || action === 'llm_on' || action === 'warm' || action === 'burst' || action === 'x402_testnet' ? setConfirm(action) : void run(action)}>{busy === action || action === 'llm_off' && offBusy ? 'Running…' : label}</button></div>;
  }
  return <main className={styles.page}><div className={styles.content}>
    <header><a href='/office'>Back to office</a><a href='/real-vs-sim'>Real vs simulated</a></header>
    <h1>Demo operator</h1>
    <p>Run the rehearsal from the app. Every action records an audit receipt. Approvals still require a passkey; calls still require consent and a dial permit.</p>
    <nav aria-label='Demo views'><a href='/office'>Office · Request call</a><a href='/controller'>Controller inbox</a><a href='/inbox'>Judge inbox</a><a href='/attack'>Attack demo</a><a href='/audit'>Audit wall</a><a href='/policy'>Policy editor</a></nav>
    {error && <p role='alert' className={styles.error}>{error}</p>}
    {!authorized ? <section><h2>Unlock on this host</h2><p>Open this page at the demo host’s numeric loopback address. The host issues a private session without sending its control key to the browser. Sessions expire after eight hours or a host restart.</p>
      <button disabled={!!busy} onClick={() => void unlock()}>Unlock local operator session</button></section> : <>
      <p role='status'>{busy ? `${operatorActions[busy as OperatorAction]?.[0] || 'Working'}…` : offBusy ? 'Turning models OFF…' : 'Operator session active.'} {links.stateStore && `State: ${links.stateStore} · Bank: ${links.bank} · LLM ${links.llmEnabled ? 'ON' : 'OFF'}`}</p>
      <button disabled={!!busy || offBusy} onClick={() => { void fetch('/api/operator/logout', { method: 'POST' }).then(response => { if (response.ok) setAuthorized(false); }); }}>Lock console</button>
      {confirm && <section role='alertdialog' aria-modal='false' aria-labelledby='confirm-title'><h2 id='confirm-title'>{operatorActions[confirm][0]}?</h2><p>{operatorActions[confirm][1]}</p>
        <button autoFocus disabled={!!busy || offBusy} onClick={() => void run(confirm)}>Confirm {operatorActions[confirm][0].toLowerCase()}</button> <button onClick={() => setConfirm(undefined)}>Cancel</button></section>}
      <section><h2>Host and company</h2>{(['status', 'health', 'preflight', 'reset'] as const).map(button)}
        {(links.approvePath || links.payPath) && <p>{links.approvePath && <a href={`${links.publicUrl || ''}${links.approvePath}`}>Current seeded approval</a>} {' · '}
          {links.payPath && <a href={`${links.publicUrl || ''}${links.payPath}`}>Current seeded payment</a>} · <a href='/office'>Reload office after reset</a></p>}
      </section>
      <section><h2>Scenarios and proof</h2><p>These runs are isolated from the office. Synthetic calls, bank effects and software authenticators remain labeled in the output.</p>
        {(['core', 'eval', 'metrics', 'scoreboard', 'burst_plan'] as const).map(button)}</section>
      <section><h2>Model controls</h2>{(['llm_off', 'llm_on', 'warm', 'burst'] as const).map(button)}</section>
      <section><h2>Pay a vendor invoice with x402</h2><p>Northfield pays its vendor through PayablesSeat and the x402 adapter. Policy must ALLOW twice, the rail caps at $2,000 and pins chain, token and recipient. The signer never leaves the host.</p>
        {(['x402_simulated', 'x402_testnet', 'x402_blocked'] as const).map(button)}</section>
      <section><h2>Authorized call payment</h2><PaymentLinkPanel /></section>
      {receipt && <section aria-label='Latest action receipt'><h2>Latest receipt</h2>{receipt.auditHref && <p><a href={receipt.auditHref}>Open action audit</a></p>}
        {isX402(receipt.result) && <X402Summary receipt={receipt.result} />}
        {!!receipt.result && typeof receipt.result === 'object' && 'exitCode' in receipt.result && typeof receipt.result.exitCode === 'number'
          && <p>Exit status: {receipt.result.exitCode} · {receipt.result.exitCode === 0 ? 'passed' : 'failed'}</p>}
        <pre>{receipt.result && typeof receipt.result === 'object' && 'output' in receipt.result && typeof receipt.result.output === 'string'
          ? receipt.result.output : JSON.stringify(receipt, null, 2)}</pre></section>}
    </>}
  </div></main>;
}
