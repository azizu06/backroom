/** Visible disclosure for the opt-in demo build only. No secret or control props. */
export function DemoBanner() {
  if (process.env.BACKROOM_DEMO !== '1') return null;
  return <aside aria-label="Rehearsal disclosure" style={{ background: '#18181b', color: '#fef3c7',
    borderBottom: '1px solid #a16207', padding: '12px 20px', font: '14px/1.5 system-ui' }}>
    <strong>REHEARSAL</strong> · Mock Nessie HTTP transport · Synthetic, preverified caller · Office connection is labeled in the view.
    {' '}StateStore connection: <code>pnpm demo:health</code>. No phone call is placed by startup.
  </aside>;
}
