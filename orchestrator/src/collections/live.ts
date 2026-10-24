/** Opt-in model service smoke. Credit/health are explicitly fake; no phone call is made. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryStateStore } from '../store';
import { runPreCall } from './index';
import { createCallPlanner } from './planner';
import { fakeCreditCheck, fakeHealthCheck } from './fakes';

const envPath = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (process.env.COLLECTIONS_LIVE !== '1') {
  console.log('SKIP: set COLLECTIONS_LIVE=1 for live model calls (credit/health remain synthetic).');
} else {
  const audit = new MemoryStateStore();
  const started = performance.now();
  const result = await runPreCall({
    clientId: 'synthetic-client', invoiceId: 'synthetic-invoice', testIdentityId: 7,
    company: { name: 'Synthetic health fixture', website: 'https://example.com' },
    context: { client: { type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
      consent: { source: 'synthetic', text: 'synthetic consent, never dial', timestamp: new Date().toISOString(), number: '+15555550100' } } },
  }, {
    credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }),
    health: fakeHealthCheck({ signals: [] }), planner: createCallPlanner(), audit,
    escalate: async () => { throw new Error('Unexpected synthetic escalation'); },
  });
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), services: { model: 'live', crs: 'fake', apify: 'fake', dial: 'none' },
    latencyMs: performance.now() - started, result, audit: await audit.listAudit() }, null, 2));
  if (result.status !== 'ready') process.exitCode = 1;
}
