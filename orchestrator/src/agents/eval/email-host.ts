/** C14 on the actual demo host route: the authenticated office call request for the seeded consumer
 * client -> production pre-call (createDemoServices, offline fixtures) -> CALL_DENIED -> the host's
 * follow-up hook -> createInboxAgents.submitCallRefusal -> collectionsPlanner on Dispatcher +
 * ClaudeAgentRuntime (scripted QueryFn) -> SIMULATED email preview. No network, model, dial or delivery. */
import { northfield } from '../../payables/northfield';
import { MemoryStateStore } from '../../store';
import { MemoryUsageLedger } from '../usage';
import { scriptedQuery } from '../mock-query';
import { createInboxAgents } from '../../../../web/lib/demo/agents';
import { createDemoServices } from '../../../../web/lib/demo/services';
import { createCallRequestHTTP, type CallRequestAudit } from '../../../../web/lib/calls/request';
import { createOperatorSignIn } from '../../../../web/lib/operator/sign-in';

const ORIGIN = 'https://demo.example';
const SIGN_IN_AT = 1_762_000_000_000;
// The email window reads the lead's fixed local hour; the clock only sets the invoice/day dedupe key.
const DAY1 = Date.parse('2026-10-27T18:00:00Z'), DAY2 = Date.parse('2026-10-28T18:00:00Z');

export async function runEmailHost() {
  const counts = { network: 0, model: 0, providerStarts: 0 };
  const noNetwork = (async () => { counts.network++; throw new Error('EVAL_NETWORK_FORBIDDEN'); }) as typeof fetch;
  const services = await createDemoServices({ env: {}, fetch: noNetwork,
    modelRoute: (async () => { counts.model++; throw new Error('EVAL_MODEL_FORBIDDEN'); }) as never });
  const control = new MemoryStateStore();
  let clock = DAY1;
  const planner = services.collectionsPlanner(control);
  const host = createInboxAgents({ control, ledger: new MemoryUsageLedger(), credential: () => 'offline-no-key',
    // The planner tries to dial; code must stop it before the host's refusing voice port.
    query: scriptedQuery(role => role === 'collections' ? [
      { tool: 'get_invoice_context', args: {} }, { tool: 'can_call', args: {} },
      { tool: 'run_precall', args: {} }, { tool: 'start_call', args: {} },
    ] : []),
    collectionsPlanner: { ...planner, now: () => clock,
      voice: { start: async (...args) => { counts.providerStarts++; return planner.voice.start(...args); } } } });
  const routeAudits: CallRequestAudit[] = [];
  const followUps: CallRequestAudit[] = [];
  // Same mapping as web/lib/demo/runtime.ts installCallRefusalFollowUp / installEmailOnlyRefusal.
  const handle = createCallRequestHTTP({ secret: () => 'operator-code', origin: () => ORIGIN, now: () => SIGN_IN_AT,
    relay: () => undefined, currentCall: async () => null, fetch: noNetwork,
    audit: async entry => { routeAudits.push(entry); },
    followUp: async entry => { followUps.push(entry); return entry.outcome === 'refused'
      ? host.submitCallRefusal({ outcome: 'refused', code: entry.code, ...(entry.detail ? { detail: entry.detail } : {}) }) : undefined; },
    emailOnlyRefusal: scenario => services.emailOnlyRefusal(control, scenario) });
  const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, {
    method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body) });
  const session = await createOperatorSignIn({ code: () => 'operator-code', origins: () => [ORIGIN], now: () => SIGN_IN_AT })(request('/api/session', { code: 'operator-code' }));
  const cookie = session.ok ? session.cookie.split(';')[0]! : '';
  const click = async (body: unknown, signedIn = true) => {
    const response = await handle(request('/api/calls/request', body, signedIn ? { cookie } : {}));
    const json = await response.json() as Record<string, unknown>;
    return { status: response.status, error: json.error, email: json.email, message: json.message };
  };
  try {
    const anonymous = await click({ scenario: 'consumer' }, false);
    const voiceOff = await click({ line: 'collections' });
    const afterControls = { sent: host.emailOutbox.sent.length, followUps: followUps.length };
    const first = await click({ scenario: 'consumer' });
    const repeat = await click({ scenario: 'consumer' });
    clock = DAY2;
    const nextDay = await click({ scenario: 'consumer' });
    await host.drain();
    const sent = host.emailOutbox.sent;
    const audits = await control.listAudit();
    const emailRows = audits.filter(row => row.action.startsWith('email_followup_'));
    const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
    const dollars = (invoice.principalCents + invoice.lateFeeCents) / 100;
    const leaks = [String(invoice.principalCents + invoice.lateFeeCents), dollars.toLocaleString('en-US'), String(dollars), '$', invoice.id];
    const checks = {
      sessionUnlocked: cookie.startsWith('backroom_session='),
      controlsSendNothing: anonymous.status === 401 && anonymous.error === 'OPERATOR_SESSION_REQUIRED' && !anonymous.email
        && voiceOff.status === 503 && voiceOff.error === 'VOICE_NOT_RUNNING' && !voiceOff.email
        && afterControls.sent === 0 && afterControls.followUps === 0,
      refusedByCode: [first, repeat, nextDay].every(row => row.status === 409 && row.error === 'CALL_DENIED')
        && routeAudits.filter(row => row.code === 'CALL_DENIED').every(row => row.detail === 'B2B_ONLY_CALLS' && row.scenario === 'consumer'),
      queuedThenDeduped: first.email === 'queued' && repeat.email === 'duplicate' && nextDay.email === 'queued'
        && /Email preview \(simulated, not sent\)/.test(String(first.message)) && /no second email/.test(String(repeat.message)),
      onePreviewPerDay: sent.length === 2 && new Set(sent.map(row => row.key)).size === 2,
      simulatedSafeContent: sent.every(row => row.label === 'SIMULATED: email preview, not sent' && row.to.endsWith('@client.example')
        && !row.linkId && leaks.every(text => !`${row.subject}\n${row.body}`.includes(text))
        && /AI assistant/.test(row.body) && /STOP/.test(row.body)),
      domainOnlyAudit: emailRows.map(row => row.action).join(',') === 'email_followup_queued,email_followup_duplicate,email_followup_queued'
        && emailRows.every(row => row.inputs?.toDomain === 'client.example') && !JSON.stringify(audits).includes(sent[0]?.to ?? '@'),
      zeroDialModelNetwork: counts.providerStarts === 0 && counts.model === 0 && counts.network === 0,
      auditChain: (await control.verifyAuditChain()).valid,
    };
    return { id: 'C14', match: Object.values(checks).every(Boolean), checks, counts,
      clicks: { anonymous, voiceOff, first, repeat, nextDay },
      previews: sent.map(row => ({ key: row.key, label: row.label, toDomain: row.to.split('@')[1], subject: row.subject, withLink: !!row.linkId })),
      emailAudits: emailRows.map(row => ({ action: row.action, ruleIds: row.ruleIds, toDomain: row.inputs?.toDomain })),
      scope: 'Authenticated createCallRequestHTTP (operator sign-in, seeded consumer scenario) -> production createDemoServices.emailOnlyRefusal pre-call (offline: mock bank, FAKE CRS/Apify) -> CALL_DENIED B2B_ONLY_CALLS -> follow-up hook mapped as in web/lib/demo/runtime.ts -> production createInboxAgents.submitCallRefusal with services.collectionsPlanner -> Dispatcher + ClaudeAgentRuntime (scripted QueryFn) -> MemoryEmailOutbox. The eval pins the dedupe clock and counts voice starts. The Next route module, demo bootstrap install, browser, live host, real email delivery and Cartesia are not executed.' };
  } finally { await host.stop(); }
}
