'use client';

import { useEffect, useRef, useState } from 'react';
import { PAYMENT_TOAST_POLL_MS, paymentLinkToAnnounce, type ActivePaymentLink } from '../../lib/office/payment-toast';
import type { OfficeSnapshot } from '../../lib/office/state';
import { PlayPanelDialog, focusAskWhy } from './PlayHud';
import './payment-toast.css';

/**
 * When a call sends a payment link, a toast says so and opens the payment panel (QR) over the office.
 * Reads the public `/api/pay/active` projection only; a replay never polls.
 */
export function PaymentToast({ snapshot }: { snapshot: OfficeSnapshot }) {
  const replay = snapshot.connection === 'replay';
  const [ready, setReady] = useState<ActivePaymentLink | null>(null);
  const [open, setOpen] = useState(false);
  const announced = useRef(new Set<string>());
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (replay) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/pay/active', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const body = await response.json() as { active?: ActivePaymentLink | null };
          const next = paymentLinkToAnnounce(body.active, announced.current, Date.now());
          if (next && !controller.signal.aborted) { announced.current.add(next.code); setReady(next); }
        }
      } catch { /* The toast is optional; the lobby kiosk still shows the link. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, PAYMENT_TOAST_POLL_MS);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [replay]);
  useEffect(() => {
    if (!ready || open) return;
    const timer = setTimeout(() => setReady(null), Math.max(0, ready.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ready, open]);
  function close() { setOpen(false); setReady(null); }
  return <>
    {ready && !open && <div className='office-payment-toast' role='status'>
      <strong>Payment link ready</strong>
      <button ref={opener} type='button' onClick={() => setOpen(true)}>Show QR</button>
      <button type='button' aria-label='Dismiss payment link notice' onClick={() => setReady(null)}>×</button>
    </div>}
    {open && <div className='office-payment-dialog'>
      <PlayPanelDialog snapshot={snapshot} target={{ kind: 'paylink' }} close={close} askWhy={question => { close(); focusAskWhy(question); }} />
    </div>}
  </>;
}
