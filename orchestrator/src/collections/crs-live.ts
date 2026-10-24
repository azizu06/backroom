/** One explicit P07 public-record / P13 fraud-risk probe through code policy; never dials, models, or pays. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CrsError } from '../integrations/crs';
import { MemoryStateStore } from '../store';
import { runPreCall } from './index';
import { createPreCallCreditCheck } from './crs';
import { createBankChangeRiskCheck } from '../vendor/crs';
import { VendorSeat } from '../vendor';
import { PayablesSeat, createNorthfieldRepository, northfieldChange, northfieldInvoice, northfieldSource } from '../payables';

const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
async function main() {
  if (process.env.PRECALL_CRS !== 'live' || process.env.VENDOR_CRS !== 'live') {
    console.log('SKIP: PRECALL_CRS=live VENDOR_CRS=live opts into P07/P13 sandbox policy wiring.');
    return;
  }
  if (!process.env.CRS_USERNAME || !process.env.CRS_PASSWORD) throw new Error('credentials unavailable');
  const state = new MemoryStateStore();
  const preCall = await runPreCall({ clientId: 'synthetic-crs-probe', invoiceId: 'synthetic-crs-probe', testIdentityId: 7,
    company: { name: 'Synthetic probe', website: 'https://example.com' }, context: {
      client: { type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
        consent: { source: 'synthetic probe; never dial', text: 'synthetic consent', timestamp: new Date().toISOString(), number: '+15555550100' } },
    } }, { credit: createPreCallCreditCheck(), health: { check: async () => ({ signals: [] }) },
      planner: { draft: async () => { throw new Error('unexpected model'); } }, audit: state, escalate: async () => {} });
  // Explicit, ephemeral test mapping only: this does not alter Northfield's frozen/unmapped seed master.
  const risk = createBankChangeRiskCheck({ identityForVendor: id => id === 'cedar' ? 13 : undefined });
  // Memoize the one projected fraud response so vendor + Payables consume the same observation.
  const observedRisk = await risk.check('cedar');
  const bankChangeRisk = { check: async (id: string) => { if (id !== 'cedar') throw new Error('unknown test mapping'); return observedRisk; } };
  const controller = { request: async () => 'synthetic-probe-controller-no-approval' };
  const repository = await createNorthfieldRepository();
  const { fields, source } = northfieldChange('bc-legitimate');
  const vendor = await new VendorSeat({ state, repository, controller, bankChangeRisk, checks: {
    // Unsupported sandbox products stay unavailable; the fraud hold cannot verify an account.
    business: async () => ({ verified: false, evidenceRef: 'business-credit-unavailable-in-sandbox' }),
    ofac: async () => ({ status: 'unknown', evidenceRef: 'ofac-unavailable-in-sandbox' }),
    footprint: async () => ({ domain: fields.domain, websiteReachable: false, listingOperating: false, evidenceRef: 'health-not-run' }),
  } }).propose(fields, source);
  const payables = await new PayablesSeat({ state, repository, controller, bankChangeRisk,
    nessie: { payInvoice: async () => { throw new Error('unexpected payment'); } } }).process(northfieldInvoice('4480'), northfieldSource('4480'));
  const valid = preCall.status === 'blocked' && preCall.decision?.ruleIds.includes('BANKRUPTCY_STOP') &&
    vendor.status === 'held' && vendor.decision.ruleIds.includes('FRAUD_RISK_HOLD') &&
    payables.status === 'held' && payables.decision.ruleIds.includes('FRAUD_RISK_HOLD');
  const entries = await state.listAudit();
  const receipt = { measuredAt: new Date().toISOString(), command: 'PRECALL_CRS=live VENDOR_CRS=live pnpm --filter @backroom/orchestrator crs:wiring:live',
    label: 'Live CRS sandbox; synthetic company and ephemeral P07/P13 mappings',
    publicRecords: entries.find(row => row.action === 'credit_check')?.inputs,
    fraudRisk: observedRisk, decisions: { preCall, vendor, payables }, passed: valid,
    notRun: ['business credit (not available in sandbox)', 'OFAC (not available in sandbox)', 'Apify', 'models', 'phone call', 'bank payment', 'controller approval'],
    note: 'Counts cannot distinguish open from discharged bankruptcy: conservatively stop/escalate any bankruptcy record. P07 is published as open Ch.13, not inferred from the response.' };
  if (!valid) throw new Error('wiring did not hold');
  const directory = fileURLToPath(new URL('../../../docs/evidence/crs/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}wiring-live-run.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log('PASS: docs/evidence/crs/wiring-live-run.json (summaries and hashes only)');
}
main().catch(error => {
  // CrsError is a fixed client-authored code/status message; never print arbitrary provider exceptions.
  console.error(error instanceof CrsError ? error.message : 'CRS wiring probe failed; verify credentials and sandbox availability. No raw provider error recorded.');
  process.exitCode = 1;
});
