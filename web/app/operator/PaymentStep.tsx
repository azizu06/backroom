'use client';
import { formatUsd, useActivePaymentLink } from '../../components/useActivePaymentLink';
import styles from './operator.module.css';

/** Read-only view of the active call payment link; same projection as the lobby kiosk. No payment authority. */
export default function PaymentStep() {
  const { link: active, error } = useActivePaymentLink();
  if (error) return <p className={styles.muted}>Payment link unavailable. Reconnecting…</p>;
  if (!active) return <p className={styles.muted}>Appears here once Dana approves a payment plan.</p>;
  return <div className={styles.qr}>
    {/* QR is generated on the server; the payment capability is never sent to an image service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={active.qr} width={192} height={192} alt='Scan to open the authorized payment page' />
    <div>
      <p><strong>{formatUsd(active.amountCents)}</strong> · code {active.code} · expires {new Date(active.expiresAt).toLocaleTimeString()}</p>
      {active.localOnly && <p className={styles.muted}>Local rehearsal link; a phone cannot open it.</p>}
      <a href={active.url} rel='noreferrer'>{active.url}</a>
    </div>
  </div>;
}
