'use client';
import { useEffect, useState } from 'react';
type Delivery = { code: string; url: string; amountCents: number; expiresAt: number; qr: string };
/** Read-only projection. Mount in office/lobby; no server secrets or payment authority. */
export default function PaymentLinkPanel() {
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
  return <section aria-label="Call payment link" style={{ maxWidth: 360, padding: 20, background: "#161a20", color: "#f2f2f2", border: "1px solid #343b46", borderRadius: 12, fontFamily: "system-ui, sans-serif" }}>
    <h2>Scan to pay</h2>
    {error ? <p role="status">Payment link unavailable. Reconnecting…</p> : active ? <>
      {/* QR is generated locally; the payment capability is never sent to an image service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={active.qr} width={256} height={256} alt="Scan to open your authorized payment page" />
      <p>Code: <strong>{active.code}</strong></p>
      <a href={active.url} rel="noreferrer" style={{ color: "#9dc2ff", overflowWrap: "anywhere" }}>{active.url}</a>
      <p>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(active.amountCents / 100)} · Expires {new Date(active.expiresAt).toLocaleTimeString()}</p>
      <p>Nessie sandbox · simulated card</p>
    </> : <p role="status">Waiting for an authorized payment plan…</p>}
  </section>;
}
