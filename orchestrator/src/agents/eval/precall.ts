/** Pre-call stops (C11, C13, C14, C15, C16, C22): the production Collections planner must refuse with the
 * frozen key's rule and never dial, and a direct dial that skips the planner (the production dial path,
 * createDialCallStarter -> dialCollectionCall) must be rejected before any provider request. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context } from '@backroom/policy';
import { createDialCallStarter, runCollectionsPlanner } from '../roles/collections';
import { MemoryHandoffStore } from '../handoff-store';
import type { Json } from '../contracts';
import { mockRuntime } from './runtime';
import { context, type Trace } from './chain';
import { MemoryStateStore } from '../../store';
import { northfield } from '../../payables';
import { fakeCreditCheck, fakeHealthCheck } from '../../collections/fakes';

const root = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(`${root}${path}`, 'utf8'));
export const PRECALL_STOPS = ['C11', 'C13', 'C14', 'C15', 'C16', 'C22'] as const;
export type PrecallStop = typeof PRECALL_STOPS[number];
/** A Tuesday in October, 11:00 or 22:00 in Los Angeles: the dial path derives local time itself. */
const at = (hour: number) => new Date(Date.UTC(2026, 9, 27, hour + 7, 0, 0));

export async function runPrecallStop(id: PrecallStop) {
  const scenario = read('scenarios/collections.json').find((row: any) => row.id === id);
  const expected = read('answer-key/expected.json').collections[id].expectedSteps[0] as { kind: string; ruleIds: string[] };
  const over = scenario.steps[0].contextOverrides ?? {};
  const invoice = northfield.arInvoices.find(row => row.id === scenario.invoiceId)!;
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  const consent = over.client && 'consent' in over.client ? over.client.consent ?? undefined : client.consent;
  const type = (over.client?.type ?? client.type) as 'business' | 'consumer';
  const localHour = over.client?.localHour ?? 11;
  const ctxClient = { type, phoneNumber: client.phoneNumber, dnc: client.dnc, localWeekday: 2, localHour, ...(consent && { consent }) };
  const policyContext: Context = { client: ctxClient, ...(over.signals && { signals: over.signals }) };
  const state = new MemoryStateStore();
  const trace: Trace[] = [];
  const providerRequests: string[] = [];
  const prepared: string[] = [];
  const dialAudits: string[] = [];
  const dialInput = { sessionId: `sess-${id}`, agentId: 'offline-agent', fromNumberId: 'offline-number', clientId: client.id,
    businessName: 'Northfield Studio', contactName: client.name, invoiceId: invoice.id, callbackNumber: '+12025550100',
    client: { type, number: client.phoneNumber, timeZone: client.timezone, dnc: client.dnc, ...(consent && { consent }) },
    ...(over.signals && { signals: over.signals }) };
  // The production CallStarter over a provider stub: any request here would be a dial.
  const voice = createDialCallStarter({ apiKey: 'offline-not-a-key', now: at(localHour),
    http: async url => { providerRequests.push(String(url)); return Response.json({ calls: [{ agent_call_id: 'should-not-happen' }] }); },
    audit: async entry => { dialAudits.push(entry.action); }, prepare: async session => { prepared.push(session.id); } });
  const deps = {
    cases: { load: async () => ({ sessionId: dialInput.sessionId, invoice: { amountCents: invoice.principalCents + invoice.lateFeeCents, currency: 'USD', daysPastDue: 40 },
      precall: { clientId: client.id, invoiceId: invoice.id, testIdentityId: 7, company: { name: client.name, website: 'https://example.invalid' }, context: policyContext },
      dial: dialInput }) },
    voice,
    precall: { credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }), health: fakeHealthCheck({ signals: [] }),
      planner: { draft: async () => ({ output: { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const],
        plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } }, route: 'local' as const, model: 'offline', latencyMs: 0, costUsd: 0 }) },
      audit: state, escalate: async () => {} },
  };
  // 1. The planner, scripted to try every step including start_call; code must refuse.
  const planned = await runCollectionsPlanner(mockRuntime(new MemoryHandoffStore({ audit: state }), async (_spec, _ctx, call) => {
    await call('get_invoice_context');
    await call('can_call');
    await call('run_precall');
    await call('start_call');
  }, (role, tool, output) => trace.push({ role, tool, output })), context(`precall:${id}`, 'collections', [`ar_invoice:${invoice.id}`]), deps);
  const permit = trace.find(row => row.tool === 'can_call')?.output as Record<string, Json> | undefined;
  const plannerProviderRequests = providerRequests.length;
  // 2. A direct dial that skips the planner.
  let directError: string | undefined;
  try { await voice.start(dialInput as never); } catch (error) { directError = error instanceof Error ? error.message : 'ERROR'; }
  const checks = {
    plannerRule: permit?.decision === expected.kind && JSON.stringify(permit?.ruleIds) === JSON.stringify(expected.ruleIds),
    plannerNoDial: planned.kind === 'not_started' && plannerProviderRequests === 0,
    directDialRejected: directError === expected.ruleIds.join(','),
    noProviderRequest: providerRequests.length === 0 && prepared.length === 0 && !dialAudits.includes('CALL_PERMIT'),
    auditChain: (await state.verifyAuditChain()).valid,
  };
  return { id, match: Object.values(checks).every(Boolean), checks, expected, permit: permit ? { decision: permit.decision, ruleIds: permit.ruleIds } : null,
    plannerResult: planned.kind, directError: directError ?? null, providerRequests: providerRequests.length,
    scope: 'Production Collections planner tools + ClaudeAgentRuntime (scripted QueryFn tries start_call) and the production dial path createDialCallStarter -> dialCollectionCall over a provider stub. UI call-button state, email-only follow-up, live CRS/Apify evidence and real Cartesia are not executed.' };
}
