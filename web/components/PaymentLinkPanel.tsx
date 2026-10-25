'use client';
import { formatUsd, useActivePaymentLink } from './useActivePaymentLink';

/** Read-only projection. Mount in office/lobby; no server secrets or payment authority.
 * `title` and `payButton` serve in-app pages (/calls, /payment-link); `idle={false}` renders nothing until a link is ready. */
export default function PaymentLinkPanel({ title = 'Scan to pay', payButton = false, idle = true }: { title?: string; payButton?: boolean; idle?: boolean }) {
  const { link: active, error } = useActivePaymentLink();
  if (!idle && !active) return null;
  return <section aria-label="Call payment link" style={{ boxSizing: "border-box", maxWidth: 360, padding: payButton ? "20px 24px" : "4px 24px 20px", background: "var(--bubble-glass)", color: "var(--ink)", border: "var(--bubble-border)", borderRadius: "var(--bubble-radius)", boxShadow: "var(--bubble-shadow)", fontFamily: "var(--font-ui)" }}>
    <h2 style={payButton ? { margin: "0 0 12px", fontSize: 19, fontWeight: 800 } : undefined}>{title}</h2>
    {active?.localOnly ? <p>Local link only; a phone cannot open it.</p> : null}
    {error ? <p role="status">Payment link unavailable. Reconnecting…</p> : active ? <>
      {/* QR is generated locally; the payment capability is never sent to an image service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={active.qr} width={256} height={256} alt="Scan to open your authorized payment page" style={{ display: "block", maxWidth: "100%", height: "auto" }} />
      <p>Code: <strong>{active.code}</strong></p>
      {payButton && <p><a href={active.url} rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "0 20px", borderRadius: 999, color: "var(--paper)", background: "var(--ink)", fontWeight: 800, textDecoration: "none" }}>Pay {formatUsd(active.amountCents)}</a></p>}
      <a href={active.url} rel="noreferrer" style={{ color: "var(--ink)", fontWeight: 800, overflowWrap: "anywhere" }}>{active.url}</a>
      <p>{formatUsd(active.amountCents)} · Expires {new Date(active.expiresAt).toLocaleTimeString()}</p>
      {active.bankLine ? <p>{active.bankLine}</p> : null}
    </> : <p role="status">Waiting for an authorized payment plan…</p>}
  </section>;
}
