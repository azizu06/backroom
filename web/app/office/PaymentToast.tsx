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
  const dismissed = useRef(new Set<string>());
  function dismiss() {
    if (ready) {
      dismissed.current.add(ready.code);
      try { localStorage.setItem(`backroom.payment-dismissed.${ready.code}`, '1'); } catch { /* Memory dismissal still works without storage. */ }
    }
    setOpen(false); setReady(null);
  }
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (replay) { setReady(null); setOpen(false); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/pay/active', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const body = await response.json() as { active?: ActivePaymentLink | null };
          if (body.active?.code) {
            try { if (localStorage.getItem(`backroom.payment-dismissed.${body.active.code}`) === '1') dismissed.current.add(body.active.code); } catch { /* Storage can be unavailable. */ }
          }
          const next = paymentLinkToAnnounce(body.active, dismissed.current, Date.now());
          if (!controller.signal.aborted) { setReady(next); if (!next) setOpen(false); }
        } else if (!controller.signal.aborted) { setReady(null); setOpen(false); }
      } catch {
        if (!controller.signal.aborted) { setReady(null); setOpen(false); }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, PAYMENT_TOAST_POLL_MS);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [replay]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { setReady(null); setOpen(false); }, Math.max(0, ready.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ready]);
  function close() { dismiss(); }
  return <>
    {ready && !open && <div className='office-payment-toast' role='status'>
      <strong>Payment link ready</strong>
      <button ref={opener} type='button' onClick={() => setOpen(true)}>Show QR</button>
      <button type='button' aria-label='Dismiss payment link notice' onClick={dismiss}>×</button>
    </div>}
    {open && <div className='office-payment-dialog'>
      <PlayPanelDialog snapshot={snapshot} target={{ kind: 'paylink' }} close={close} askWhy={question => { close(); focusAskWhy(question); }} />
    </div>}
  </>;
}
