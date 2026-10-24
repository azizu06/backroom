import { expect, it } from 'vitest';
import { harnessStore } from '../../../spacetime/tests/transport';
import { MemoryUsageLedger } from '@backroom/orchestrator/agents';
import { scriptedQuery } from '../../../orchestrator/src/agents/mock-query';
import { createInboxAgents } from './agents';
import { createInboxHTTP } from '../inbox/http';
import { inboxPresets } from '../inbox/presets';

it('a real inbox submission publishes private handoffs and sanitized office rows through agent_* reducers', async () => {
  const { h, transport, store: control } = harnessStore();
  const host = createInboxAgents({ control, transport, ledger: new MemoryUsageLedger(), credential: () => 'mock',
    query: (params, definitions) => {
      const refs = JSON.parse(/Starting artifact refs: (\[[^\n]+\])/.exec(params.prompt)![1]!) as string[];
      const item = refs.find(ref => ref.startsWith('judge:'))!;
      return scriptedQuery(role => role === 'intake' ? [
        { tool: 'read_inbox_item', args: { itemRef: item } },
        { tool: 'handoff', args: { to: 'extractor', reason: 'completed', summary: 'Read the submitted document.', artifactRefs: [item] } },
      ] : role === 'extractor' ? [
        { tool: 'read_document', args: { documentRef: item, chunk: 0 } },
        { tool: 'local_extract', args: { documentRef: item } },
        { tool: 'validate_extraction', args: (o: any[]) => ({ documentRef: item, fields: o[1].fields }) },
        { tool: 'handoff', args: (o: any[]) => ({ to: 'vendor', reason: 'completed',
          summary: 'Bank account 123456789 and billing@example.com remain private.', artifactRefs: [item, o[2].artifactRef] }) },
      ] : [{ tool: 'get_vendor_master', args: {} }])(params, definitions);
    } });
  try {
    const preset = inboxPresets.find(row => row.id === '4471')!;
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...preset, presetId: preset.id })) form.set(key, value);
    const response = await createInboxHTTP({ store: () => control, agents: input => host.submit(input) })(new Request('http://localhost/api/inbox', {
      method: 'POST', headers: { origin: 'http://localhost' }, body: form }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.decision.ruleIds).toContain('LOOKALIKE_DOMAIN');
    await host.drain();
    const rows = [...h.db.agent_handoff_public.iter()].sort((a, b) => Number(a.sequence - b.sequence));
    expect(rows.map(row => [row.fromRole, row.toRole, row.status])).toEqual([
      ['intake', 'extractor', 'completed'], ['extractor', 'vendor', 'completed'],
    ]);
    expect([...h.db.agent_handoff.iter()]).toHaveLength(2);
    expect(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toMatch(/123456789|billing@example.com|artifactRefs/);
    expect(await host.store.getCase(`agent:${body.id}`)).toMatchObject({ status: 'held' });
    expect((await control.getAudit(body.auditId))?.inputs?.scenario_source).toBe('judge');
    expect(await control.verifyAuditChain()).toMatchObject({ valid: true });
  } finally { await host.stop(); await control.close(); }
});
