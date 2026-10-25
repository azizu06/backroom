import { describe, expect, it, vi } from 'vitest';
import { readCaseBalance } from './balance-client';

const signal = new AbortController().signal;
describe('invoice balance access', () => {
  it('does not request protected data while signed out, including repeated polls', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ signedIn: false }));
    for (let i = 0; i < 3; i++) expect(await readCaseBalance(signal, transport)).toEqual({ signedIn: false, balance: null });
    expect(transport.mock.calls.every(call => call[0] === '/api/audit/session')).toBe(true);
  });
  it('reads the invoice after sign-in and clears it after sign-out', async () => {
    const balance = { invoiceId: '1042' };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ balance }))
      .mockResolvedValueOnce(Response.json({ signedIn: false }));
    expect(await readCaseBalance(signal, transport)).toEqual({ signedIn: true, balance });
    expect(await readCaseBalance(signal, transport)).toEqual({ signedIn: false, balance: null });
    expect(transport.mock.calls.map(call => call[0])).toEqual(['/api/audit/session', '/api/audit/balance', '/api/audit/session']);
  });
  it('returns to the access gate if the session expires between requests', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await readCaseBalance(signal, transport)).toEqual({ signedIn: false, balance: null });
  });
});
