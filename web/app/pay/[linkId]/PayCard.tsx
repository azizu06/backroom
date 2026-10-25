'use client';
import { useCallback, useEffect, useState } from 'react';
import type { PaymentView } from '@backroom/orchestrator';
import styles from './pay.module.css';
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export default function PayCard({ linkId }: { linkId: string }) {
  const [view, setView] = useState<PaymentView>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const load = useCallback(async (pay = false) => {
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/pay/${encodeURIComponent(linkId)}`, pay ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      } : { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error === 'PAYMENT_LINK_NOT_FOUND' ? 'This payment link is unavailable.'
          : data.error === 'DEPOSIT_UNCERTAIN_REVIEW_REQUIRED' ? 'Deposit needs review. Do not create another payment. Contact Northfield Studio.'
          : data.error === 'SANDBOX_WHOLE_DOLLARS_REQUIRED' ? 'Only whole-dollar payments are supported. Contact Northfield Studio.'
          : 'Payment service unavailable. Refresh to check for a posted deposit before trying again.');
        return;
      }
      setView(data);
    } catch { setError('Connection interrupted. Refresh to check payment status before trying again.'); }
    finally { setPending(false); }
  }, [linkId]);
  useEffect(() => { void load(); }, [load]);
  const payment = view?.payment;
  return <main className={styles.page}><article className={styles.card}>
    <p className={styles.business}>Northfield Studio</p>
    <h1>Invoice payment</h1>
    {view ? <>
      <p className={styles.notice}>{view.balance.cardNotice}</p>
      <dl className={styles.details}><div><dt>Invoice</dt><dd>#{view.invoiceId}</dd></div>
        <div><dt>Installment</dt><dd>{view.installment}</dd></div>
        <div><dt>Amount due</dt><dd className={styles.amount}>{money(view.amountCents / 100)}</dd></div></dl>
      <p>The amount is fixed by your authorized payment plan. No card details are collected.</p>
      <button disabled={pending || Boolean(payment) || Boolean(error)} onClick={() => void load(true)}>
        {pending ? 'Checking payment…' : payment ? 'Deposit recorded' : `Pay ${money(view.amountCents / 100)}`}
      </button>
      {payment && <p role="status" className={styles.status}>{payment.status === 'pending_reconciliation'
        ? 'Deposit posted. Awaiting reconciliation; your invoice is still open.'
        : payment.status === 'exception' ? 'Deposit needs review. Your invoice has not been cleared.'
        : payment.status === 'paid' ? 'Payment matched. Invoice paid.' : 'Payment matched. Invoice partially paid.'}</p>}
      {payment && <p className={styles.reference}>Deposit reference: {payment.depositId}</p>}
      <section className={styles.balance} aria-label={view.balance.readbackLabel}><h2>{view.balance.label}</h2>
        <p className={styles.amount}>{money(view.balance.displayTotal)}</p>
        <p>Account balance: {money(view.balance.accountBalance)}<br />Posted deposits: {money(view.balance.postedDepositsTotal)}</p>
        <p>{view.balance.readNote}</p></section>
    </> : !error && <p role="status">Loading payment link…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.refresh} disabled={pending} onClick={() => void load()}>Refresh payment status</button>
  </article></main>;
}
