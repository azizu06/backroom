import { expect, it, vi } from 'vitest';
import type { Decision } from '@backroom/policy';
import { runPreCall } from './index';
import { createPreCallCreditCheck } from './crs';
import { MemoryStateStore } from '../store';

const crsHttp = () => vi.fn<typeof fetch>(async url => {
  if (String(url).endsWith('/users/login')) return Response.json({ token: 'test-only' });
  if (String(url).endsWith('/pp/fcrablj/data')) return Response.json({ BankruptciesFound: 1, JudgmentsFound: 0, LiensFound: 0, privateName: 'must not escape' });
  throw new Error('Unexpected endpoint');
});
it('P07 public records stop and escalate before planning; OFAC remains unavailable', async () => {
  const http = crsHttp(), store = new MemoryStateStore(), draft = vi.fn();
  const now = Date.now();
  await store.registerAgent('crs-test', 'collections', now);
  await store.enqueueTask({ id: 'crs-precall', seatId: 'collections', refs: ['1042'], steps: [] });
  const lease = (await store.claimTask('crs-test', now, 60_000))!;
  const escalate = vi.fn(async (decision: Extract<Decision, { kind: 'ESCALATE' }>) => { await store.createEscalation(lease, decision, now); });
  const result = await runPreCall({ clientId: 'synthetic', invoiceId: '1042', testIdentityId: 7,
    company: { name: 'Synthetic', website: 'https://example.com' },
    context: { client: { type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
      consent: { source: 'test', text: 'consent', timestamp: '2026-10-24T01:00:00Z', number: '+15555550100' } } },
  }, { credit: createPreCallCreditCheck({ PRECALL_CRS: 'live', CRS_USERNAME: 'test', CRS_PASSWORD: 'test' }, http),
    health: { check: async () => ({ signals: [] }) }, planner: { draft }, audit: store, escalate });
  expect(result).toMatchObject({ status: 'blocked', decision: { kind: 'ESCALATE', ruleIds: ['BANKRUPTCY_STOP'], quote: { sentenceId: 'NF-010' } } });
  expect(escalate).toHaveBeenCalledOnce();
  const escalationId = (await store.getTask('crs-precall'))!.escalationId!;
  expect(await store.getEscalation(escalationId)).toMatchObject({ status: 'pending', ruleIds: ['BANKRUPTCY_STOP'], toHuman: 'Dana' });
  expect(draft).not.toHaveBeenCalled();
  const audit = await store.listAudit();
  expect(audit.find(row => row.action === 'credit_check')?.inputs).toMatchObject({ label: 'CRS sandbox: test identity #7', ofacStatus: 'unknown', ofacAvailability: 'not available in sandbox', evidence: [{ product: 'publicRecords', responseHash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  expect(JSON.stringify(audit)).not.toContain('must not escape');
});

it.each(['no-records', 'http-failure', 'missing-credentials'] as const)('never treats %s as sandbox OFAC clearance', async outcome => {
  const http = vi.fn<typeof fetch>(async url => {
    if (outcome === 'http-failure') return new Response('', { status: 503 });
    return Response.json(String(url).endsWith('/users/login') ? { token: 'test' } : { BankruptciesFound: 0, JudgmentsFound: 0, LiensFound: 0 });
  });
  const check = createPreCallCreditCheck({ PRECALL_CRS: 'live', ...(outcome === 'missing-credentials' ? {} : { CRS_USERNAME: 'test', CRS_PASSWORD: 'test' }) }, http);
  if (outcome === 'no-records') expect(await check.check(7)).toMatchObject({ bankruptcy: false, ofacStatus: 'unknown', ofacAvailability: 'not available in sandbox' });
  else await expect(check.check(7)).rejects.toThrow();
  if (outcome === 'missing-credentials') expect(http).not.toHaveBeenCalled();
});
it('default pre-call fake is explicit and makes no network call', async () => {
  const http = vi.fn<typeof fetch>(), check = createPreCallCreditCheck({}, http);
  expect(check.label).toBe('FAKE');
  expect(await check.check(7)).toMatchObject({ ofacStatus: 'clear', evidence: [] });
  expect(http).not.toHaveBeenCalled();
});
