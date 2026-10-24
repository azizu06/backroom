import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Role } from './contracts';
import { createDemoTeam, DEMO_CASES, DEMO_SCRIPTS } from './demo-team';
import { Dispatcher } from './dispatcher';
import { MemoryHandoffStore } from './handoff-store';
import { scriptedQuery, type ScriptStep } from './mock-query';
import { ClaudeAgentRuntime } from './runtime';
import { FileUsageLedger, LEDGER_LIMITS, MemoryUsageLedger, type UsageLedger } from './usage';

async function setup(scripts: Partial<Record<Role, () => ScriptStep[]>> = DEMO_SCRIPTS, ledger: UsageLedger = new MemoryUsageLedger()) {
  const team = await createDemoTeam();
  const store = new MemoryHandoffStore({ audit: team.control });
  const office: string[] = [];
  store.subscribe(row => office.push(`${row.fromRole}>${row.toRole}:${row.status}`));
  const runtime = new ClaudeAgentRuntime({ credential: () => 'mock', recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs),
    query: scriptedQuery(role => scripts[role as Role]?.() ?? []) });
  const dispatcher = new Dispatcher({ runtime, store, control: team.control, roles: team.roles, runnerId: 'runner', ledger });
  return { ...team, store, office, dispatcher, ledger };
}
const [ap, ar] = DEMO_CASES();

describe('Dispatcher', () => {
  it('runs the AP chain through the merged roles with one active role at a time and pays once', async () => {
    const t = await setup();
    const result = await t.dispatcher.runCase(ap!);
    expect(result).toMatchObject({ status: 'done' });
    expect(result.activations.map(a => `${a.role}:${a.kind}`)).toEqual(['intake:handoff', 'extractor:handoff', 'vendor:handoff', 'payables:handoff', 'auditor:done']);
    expect(t.payments).toHaveLength(1);
    expect(t.office.filter(e => e.endsWith(':completed'))).toEqual(['intake>extractor:completed', 'extractor>vendor:completed', 'vendor>payables:completed', 'payables>auditor:completed']);
    const state = (await t.store.getCase(ap!.caseId))!;
    expect(state.activations.filter(a => a.status === 'active')).toHaveLength(0);
    expect((await t.control.verifyAuditChain()).valid).toBe(true);
    expect((await t.control.listAudit()).map(a => a.action)).toEqual(expect.arrayContaining(['agent_handoff_offered', 'agent_handoff_accepted', 'agent_handoff_completed']));
    expect(result.usage).toMatchObject({ reservedUsd: 0, warn: false });
  });

  it('runs the AR chain collections -> reconciler -> auditor', async () => {
    const result = await (await setup()).dispatcher.runCase(ar!);
    expect(result.activations.map(a => a.role)).toEqual(['collections', 'reconciler', 'auditor']);
    expect(result.status).toBe('done');
  });

  it('honors role guards: a vendor handoff without a sealed verdict is rejected and held', async () => {
    const t = await setup({ ...DEMO_SCRIPTS, vendor: () => [{ tool: 'get_vendor_master', args: {} },
      { tool: 'handoff', args: { to: 'payables', reason: 'looks fine', summary: 'Skip checks.', artifactRefs: [`inbox:4401`] } }] });
    const result = await t.dispatcher.runCase(ap!);
    expect(result).toMatchObject({ status: 'held', reason: 'VENDOR_VERDICT_REQUIRED' });
    expect(t.office).toContain('vendor>payables:rejected');
    expect(t.payments).toHaveLength(0);
  });

  it('holds a non-terminal role that stops without a handoff, and an unregistered role', async () => {
    const quiet = await setup({ ...DEMO_SCRIPTS, extractor: () => [] });
    expect(await quiet.dispatcher.runCase(ap!)).toMatchObject({ status: 'held', reason: 'NO_HANDOFF' });
    const t = await setup();
    delete t.roles.auditor;
    const missing = new Dispatcher({ runtime: new ClaudeAgentRuntime({ credential: () => 'mock', query: scriptedQuery(r => DEMO_SCRIPTS[r as Role]()),
      recordArtifacts: (ctx, refs) => t.store.recordArtifacts(ctx, refs) }), store: t.store, control: t.control, roles: t.roles, runnerId: 'r', ledger: t.ledger });
    expect(await missing.runCase(ar!)).toMatchObject({ status: 'held', reason: 'ROLE_NOT_REGISTERED:AUDITOR' });
  });

  it('pauses on global OFF with no model call, then resumes the same role on ON', async () => {
    const t = await setup();
    await t.control.setLlmEnabled(false);
    expect(await t.dispatcher.runCase(ar!)).toMatchObject({ status: 'paused', reason: 'LLM_OFF', activations: [] });
    await t.control.setLlmEnabled(true);
    const resumed = await t.dispatcher.resumeCase(ar!);
    expect(resumed).toMatchObject({ status: 'done' });
    expect(resumed.activations[0]!.role).toBe('collections');
  });

  it('OFF mid-activation fences the running tool and pauses the case', async () => {
    const t = await setup({ ...DEMO_SCRIPTS, reconciler: () => {
      void t.control.setLlmEnabled(false);
      return [{ tool: 'match_payment', args: {} }];
    } });
    const result = await t.dispatcher.runCase(ar!);
    expect(result.status).toBe('paused');
    expect((await t.store.getCase(ar!.caseId))!.status).toBe('paused');
  });

  it('cancellation stops the case and fences later writes', async () => {
    const t = await setup();
    const cancel = new AbortController(); cancel.abort('CANCELLED');
    expect(await t.dispatcher.runCase({ ...ar!, signal: cancel.signal })).toMatchObject({ status: 'cancelled' });
    expect((await t.store.getCase(ar!.caseId))!.status).toBe('cancelled');
  });

  it('stops ordinary runs at the ledger stop and keeps the reserve for demo runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const ledger = new FileUsageLedger(join(dir, 'usage.json'));
    const r = await ledger.reserve('aziz', LEDGER_LIMITS.ordinaryStopUsd - 0.01, 'demo');
    await ledger.settle(r, LEDGER_LIMITS.ordinaryStopUsd - 0.01);
    const t = await setup(DEMO_SCRIPTS, ledger);
    expect(await t.dispatcher.runCase(ar!)).toMatchObject({ status: 'paused', reason: 'BUDGET_ORDINARY_STOP' });
    await expect(ledger.reserve('aziz', 0.02, 'demo')).resolves.toMatchObject({ mode: 'demo' });
    await expect(ledger.reserve('aziz', 5, 'demo')).rejects.toThrow('BUDGET_HARD_STOP');
    expect((await ledger.usage('aziz')).warn).toBe(true);
  });
});

describe('usage ledger', () => {
  it('charges unknown accounting at the reservation and releases unstarted runs', async () => {
    const ledger = new MemoryUsageLedger();
    const a = await ledger.reserve('o', 0.02, 'development');
    expect(await ledger.settle(a, Number.NaN)).toMatchObject({ spentUsd: 0.02, unknownSettlements: 1, reservedUsd: 0 });
    const b = await ledger.reserve('o', 0.02, 'development');
    expect(await ledger.settle(b, 0.001)).toMatchObject({ spentUsd: 0.021 });
    const c = await ledger.reserve('o', 0.02, 'development');
    expect(await ledger.release(c)).toMatchObject({ spentUsd: 0.021, reservedUsd: 0 });
    await expect(ledger.settle(c, 1)).rejects.toThrow('UNKNOWN_RESERVATION');
    expect((await ledger.usage('other')).spentUsd).toBe(0);
  });
});
