import type { CaseBalance } from './balance';

/** Check the public session probe before requesting protected invoice data. */
export async function readCaseBalance(signal: AbortSignal, transport = fetch): Promise<{ signedIn: boolean; balance: CaseBalance | null }> {
  const session = await transport('/api/audit/session', { cache: 'no-store', signal });
  if (!session.ok) throw new Error('BALANCE_SESSION_UNAVAILABLE');
  if ((await session.json()).signedIn !== true) return { signedIn: false, balance: null };
  const response = await transport('/api/audit/balance', { cache: 'no-store', signal });
  if (response.status === 401) return { signedIn: false, balance: null };
  if (!response.ok) throw new Error('BALANCE_UNAVAILABLE');
  return { signedIn: true, balance: (await response.json()).balance ?? null };
}
