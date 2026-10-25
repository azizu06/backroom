'use client';
import { useEffect, useState } from 'react';
import styles from './operator.module.css';

type Delivery = { code: string; url: string; amountCents: number; expiresAt: number; qr: string; localOnly?: boolean; bankLine?: string };
/** Read-only view of the active call payment link; same projection as the lobby kiosk. No payment authority. */
export default function PaymentStep() {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/pay/active', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const body = await response.json();
        if (!stopped) { setDelivery(body.active); setError(false); }
      } catch { if (!stopped) { setDelivery(null); setError(true); } }
    };
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, []);
  const active = delivery && delivery.expiresAt > Date.now() ? delivery : null;
  if (error) return <p className={styles.muted}>Payment link unavailable. Reconnecting…</p>;
  if (!active) return <p className={styles.muted}>Appears here once Dana approves a payment plan.</p>;
  return <div className={styles.qr}>
    {/* QR is generated on the server; the payment capability is never sent to an image service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={active.qr} width={192} height={192} alt='Scan to open the authorized payment page' />
    <div>
      <p><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(active.amountCents / 100)}</strong> · code {active.code} · expires {new Date(active.expiresAt).toLocaleTimeString()}</p>
      {active.localOnly && <p className={styles.muted}>Local rehearsal link; a phone cannot open it.</p>}
      <a href={active.url} rel='noreferrer'>{active.url}</a>
    </div>
  </div>;
}
