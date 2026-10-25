import { afterEach, expect, it, vi } from 'vitest';
import { CONVERSATIONS, runConversation } from './conversation';

afterEach(() => vi.unstubAllGlobals());

it.each(CONVERSATIONS)('%s: scripted call through the gateway, then the Dispatcher, matches the key outcome', async name => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation(name);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
  expect(run.match).toBe(true);
});

it('without the host-declared pairing the Reconciler refuses under the Dispatcher (pre-fix behaviour)', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation('already_paid_matched', { pairing: false });
  expect(run.roles).toEqual(['collections']);
  expect(run).toMatchObject({ caseStatus: 'held', reason: 'RECONCILIATION_CASE_MISMATCH' });
  expect(run.cleared).toBe(false);
  expect(run.match).toBe(false);
});

it('the pre-identity leak check catches the amount in any spoken format, and invoice fields', async () => {
  const { revealsInvoice } = await import('./conversation');
  const deny = { kind: 'DENY', can_confirm: false, rule_ids: ['IDENTITY_REQUIRED'], speak: 'Please confirm I am speaking with the intended contact first.' };
  expect(revealsInvoice(deny, 495000)).toBe(false);
  for (const speak of ['You owe 495000 cents', 'You owe $4,950.00', 'about 4950 dollars', 'total 4950.00']) {
    expect(revealsInvoice({ ...deny, speak }, 495000)).toBe(true);
  }
  expect(revealsInvoice({ ...deny, invoice_id: '1042' }, 495000)).toBe(true);
});
