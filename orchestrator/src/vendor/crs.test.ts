import { expect, it, vi } from 'vitest';
import { createBankChangeRiskCheck } from './crs';
import { PayablesSeat, createNorthfieldRepository, northfieldInvoice, northfieldSource } from '../payables';
import { MemoryStateStore } from '../store';

it.each([88, 12, 'unavailable', 'unmapped'] as const)('bank change with CRS %s remains unpaid', async outcome => {
  const http = vi.fn<typeof fetch>(async url => {
    if (String(url).endsWith('/users/login')) return Response.json({ token: 'test' });
    if (outcome === 'unavailable') throw new Error('provider PII must not escape');
    return Response.json({ risk: { score: outcome } });
  });
  const state = new MemoryStateStore(), repository = await createNorthfieldRepository();
  const nessie = { payInvoice: vi.fn() }, controller = { request: vi.fn(async () => 'escalation-test') };
  const risk = createBankChangeRiskCheck({ env: { VENDOR_CRS: 'live', CRS_USERNAME: 'test', CRS_PASSWORD: 'test' },
    fetch: http, identityForVendor: () => outcome === 'unmapped' ? undefined : 13 });
  const result = await new PayablesSeat({ repository, state, nessie, controller, bankChangeRisk: risk }).process(northfieldInvoice('4480'), northfieldSource('4480'));
  expect(result.status).toBe('held');
  expect(result.decision.ruleIds).toContain('BANK_CHANGE_HOLD');
  expect(result.decision.ruleIds).toContain(outcome === 88 ? 'FRAUD_RISK_HOLD' : outcome === 12 ? 'BANK_CHANGE_HOLD' : 'INVALID_INPUT');
  expect(nessie.payInvoice).not.toHaveBeenCalled();
  if (outcome === 'unmapped') expect(http).not.toHaveBeenCalled();
  expect(JSON.stringify(await state.listAudit())).not.toContain('provider PII');
});

it('default fake makes no network call and labels its synthetic result', async () => {
  const http = vi.fn<typeof fetch>();
  expect(await createBankChangeRiskCheck({ env: {}, fetch: http }).check('any-vendor')).toMatchObject({ label: 'FAKE: synthetic fraud risk (not checked)' });
  expect(http).not.toHaveBeenCalled();
});
it('rejects fixture evidence instead of surfacing it as live CRS sandbox proof', async () => {
  const { createCrsBankChangeRisk } = await import('./crs');
  const check = createCrsBankChangeRisk({ getFraudRisk: async () => ({ source: 'crs_sandbox', product: 'fraudRisk', testIdentityId: 13,
    label: 'FAKE: CRS fixture, test identity #13', checkedAt: '2026-10-24T00:00:00Z', responseHash: 'a'.repeat(64), summary: { fraudRiskScore: 88 } }) }, () => 13);
  await expect(check.check('synthetic')).rejects.toThrow('Invalid CRS evidence');
});
it('live risk never falls back to a fake score when credentials are missing', async () => {
  const http = vi.fn<typeof fetch>();
  await expect(createBankChangeRiskCheck({ env: { VENDOR_CRS: 'live' }, fetch: http, identityForVendor: () => 13 }).check('synthetic')).rejects.toThrow('CRS credentials unavailable');
  expect(http).not.toHaveBeenCalled();
});
