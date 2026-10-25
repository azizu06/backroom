import { balanceLine, type PlanBalance as Balance } from '@backroom/orchestrator/payment-schedule';

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const cell = { padding: '6px 4px', borderBottom: '1px solid var(--line)', textAlign: 'left' } as const;

/** Read-only remaining balance and plan schedule. Paid comes only from exact reconciled payments; it moves no money. */
export default function PlanBalance({ balance, label = 'Payment plan' }: { balance: Balance; label?: string }) {
  return <section aria-label={label} style={{ marginTop: 16, fontVariantNumeric: 'tabular-nums' }}>
    <p style={{ fontWeight: 800, margin: '0 0 8px' }}>{balanceLine(balance)}</p>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <caption style={{ textAlign: 'left', fontWeight: 600, padding: '4px 0' }}>{label}</caption>
      <thead><tr><th scope="col" style={cell}>Installment</th><th scope="col" style={cell}>Amount</th>
        <th scope="col" style={cell}>Due</th><th scope="col" style={cell}>Status</th></tr></thead>
      <tbody>{balance.schedule.map(row => <tr key={row.installment}>
        <td style={cell}>{row.installment} of {balance.schedule.length}</td><td style={cell}>{usd(row.amountCents)}</td>
        <td style={cell}>{day(row.dueDate)}</td><td style={{ ...cell, fontWeight: row.status === 'paid' ? 800 : 400 }}>{row.status === 'paid' ? 'Paid' : 'Upcoming'}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
