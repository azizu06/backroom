// Isolated $0 rehearsal: real Next routes, existing runtime, scripted SDK query; no live host changes.
import next from 'next';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createDemoRuntime } from '../lib/demo/runtime';
import { createInboxAgents } from '../lib/demo/agents';
import { MemoryUsageLedger } from '@backroom/orchestrator/agents';
import { scriptedQuery, type ScriptStep } from '../../orchestrator/src/agents/mock-query';
import { createAttackDemoListener } from '../../orchestrator/src/attack-demo/server';
import { getStateStore } from '@backroom/orchestrator';

const dir = fileURLToPath(new URL('../', import.meta.url));
const port = 3057, origin = `http://127.0.0.1:${port}`;
Object.assign(process.env, { STATE_STORE: 'memory', BACKROOM_DEMO: '1', DEMO_LIVE: '0', DEMO_LLM: 'on',
  DEMO_PORT: String(port), DEMO_PUBLIC_URL: origin, DEMO_TUNNEL: '0',
  DEMO_AGENTS: '1', GX10_ENABLED: 'false', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '',
  WEBAUTHN_ORIGIN: origin, WEBAUTHN_RP_ID: 'localhost', TOOL_GATEWAY_SECRET: 'workday-test-tool',
  CONTROLLER_ENROLLMENT_SECRET: 'workday-test-operator', ATTACK_DEMO_BASE_URL: 'http://127.0.0.1:3058', ATTACK_DEMO_LIVE: '0' });

const handoff = (to: string, refs: (o: any[]) => string[]): ScriptStep => ({ tool: 'handoff',
  args: o => ({ to, reason: 'completed', summary: 'Scripted judge-path evidence', artifactRefs: refs(o) }) });
const immediateQuery: Parameters<typeof createInboxAgents>[0]['query'] = (params, definitions) => {
  const item = /"inboxRef":"([^"]+)"/.exec(params.prompt)?.[1]
    ?? /Starting artifact refs: \["([^"]+)"/.exec(params.prompt)?.[1] ?? '';
  const scripts: Record<string, ScriptStep[]> = {
    intake: [{ tool: 'read_inbox_item', args: { itemRef: item } }, handoff('extractor', () => [item])],
    extractor: [{ tool: 'read_document', args: { documentRef: item, chunk: 0 } },
      { tool: 'local_extract', args: { documentRef: item } },
      { tool: 'validate_extraction', args: (o: any[]) => ({ documentRef: item, fields: o[1].fields }) },
      handoff('vendor', o => [item, o[2].artifactRef])],
    vendor: [{ tool: 'get_vendor_master', args: {} }, { tool: 'check_domain', args: { which: 'sender' } },
      { tool: 'check_domain', args: { which: 'claimed' } }, { tool: 'check_business', args: {} },
      { tool: 'conclude_verification', args: { outcome: 'proceed', note: 'Synthetic checks agree.' } },
      handoff('payables', o => [o[4].verdictRef])],
    payables: [{ tool: 'evaluate_invoice', args: {} }, { tool: 'request_payment', args: {} }, handoff('auditor', o => o[1].evidenceRefs)],
    collections: [{ tool: 'get_call_outcome', args: {} }, handoff('reconciler', o => o[0].allowedRefs)],
    reconciler: [{ tool: 'request_exact_match', args: {} }, handoff('auditor', o => o[0].artifactRefs)],
    auditor: [{ tool: 'read_audit', args: {} }, { tool: 'verify_chain', args: {} },
      { tool: 'record_case_summary', args: (o: any[]) => ({
        summary: `Reviewed ${o[1].auditIds.map((id: string) => `[entry:${id}]`).join(' ')}`, citations: o[1].auditIds }) }],
  };
  return scriptedQuery(role => scripts[role] ?? [], { costUsd: 0 })(params, definitions);
};


async function main() {
  const app = next({ dev: false, dir, hostname: '127.0.0.1', port });
  await app.prepare();
  const runtime = await createDemoRuntime();
  const root = globalThis as any;
  // Exercise actual tools/guards/ledger/public projection, replacing only the paid model transport.
  const query: NonNullable<Parameters<typeof createInboxAgents>[0]['query']> = (params, definitions) => {
    const source = immediateQuery!(params, definitions);
    const paced = (async function* () { await delay(900); yield* source; })();
    return Object.assign(paced, { close: () => source.close() });
  };
  const host = createInboxAgents({ ...root.backroomInboxAgentConfig, query,
    credential: () => 'scripted-no-provider', ledger: new MemoryUsageLedger(),
    vendor: { publicRecords: async () => ({ bankruptcies: 0, evidenceRef: `crs:sha256:${'b'.repeat(64)}` }) } });
  root.backroomInboxAgents = host;
  const attack = createServer(createAttackDemoListener());
  attack.listen(3058, '127.0.0.1');
  const handle = app.getRequestHandler();
  const server = createServer(async (req, res) => {
    if (req.url === '/__workday/proof') {
      const body = { rows: await host.store.listPublic(), audit: await getStateStore().listAudit(),
        batch: root.backroomWorkday?.batch.view(), usage: await host.ledger.usage('aziz') };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? Number(value) : value)); return;
    }
    await handle(req, res);
  });
  server.listen(port, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    server.close(); attack.close(); void runtime.stop().then(() => app.close()).finally(() => process.exit());
  });
}
void main();
