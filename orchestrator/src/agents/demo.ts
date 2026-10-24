import { execFileSync } from 'node:child_process';
import { createDemoTeam, DEMO_CASES, DEMO_SCRIPTS } from './demo-team';
import type { Role } from './contracts';
import { Dispatcher } from './dispatcher';
import type { MemoryHandoffStore } from './handoff-store';
import { scriptedQuery, type ScriptedCall } from './mock-query';
import { ClaudeAgentRuntime } from './runtime';
import { FileUsageLedger, MemoryUsageLedger } from './usage';

/** `pnpm --filter @backroom/orchestrator demo:agents [-- --live]`
 * Runs the AP chain (intake -> extractor -> vendor -> payables -> auditor) and the AR chain
 * (collections -> reconciler -> auditor) through the shared runtime, handoff seal,
 * dispatcher, usage ledger and office projection. Mocked by default: scripted model turns
 * drive the real tool handlers; no network, no key, $0.
 * `--live`: Claude chooses every tool and handoff (Haiku unless a role picks Sonnet). The key is
 * read from Keychain service `backroom-anthropic-key` into the child env only, and spend
 * goes to the shared ledger at `.env.agents/usage-ledger.json`. Expect about $0.01. */
const live = process.argv.includes('--live');

async function main() {
  const { control, roles, payments, store } = await createDemoTeam();
  (store as MemoryHandoffStore).subscribe(row => console.log(`  [office] #${row.sequence} ${row.fromAgentId} -> ${row.toAgentId} ${row.status}`
    + `${row.correction ? ' (correction)' : ''}${row.errorCode ? ` ${row.errorCode}` : ''} | voice=${row.toVoiceRole} "${row.line}"`));
  const calls: ScriptedCall[] = [];
  const runtime = new ClaudeAgentRuntime({
    credential: live ? () => execFileSync('security', ['find-generic-password', '-s', 'backroom-anthropic-key', '-w'], { encoding: 'utf8' }).trim() : () => 'mock-no-network',
    ...(live ? {} : { query: scriptedQuery(role => DEMO_SCRIPTS[role as Role]?.() ?? [], { calls }) }),
    recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs),
    onDiagnostic: d => console.log(`  [diagnostic] ${d.role} ${d.code}: ${d.detail}`),
  });
  const ledger = live ? new FileUsageLedger() : new MemoryUsageLedger();
  const dispatcher = new Dispatcher({ runtime, store, control, roles, runnerId: 'demo-runner', ledger, mode: 'development',
    onEvent: event => { if (event.type === 'activation_started') console.log(`[agent] ${event.role} starts ${event.activationId}`); } });
  let total = 0;
  for (const request of DEMO_CASES()) {
    const result = await dispatcher.runCase(request);
    total += result.costUsd;
    console.log(`[case] ${result.caseId} ${result.status}${result.reason ? ` (${result.reason})` : ''}: `
      + `${result.activations.map(a => `${a.role}:${a.kind}${a.reason ? `(${a.reason})` : ''}`).join(' -> ')}`);
    for (const a of result.activations) console.log(`  ${a.role} model=${a.model} session=${a.usage?.sessionId} total_cost_usd=${a.usage?.costUsd} wall=${a.usage?.wallMs}ms init=${a.usage?.initMs}ms`);
  }
  if (!live) console.log(`[runtime] refused tool calls: ${calls.filter(c => c.denied || c.isError).map(c => `${c.role}.${c.tool} (${c.denied ?? JSON.stringify(c.output)})`).join(', ') || 'none'}`);
  const chain = await control.verifyAuditChain();
  console.log(`[payments] demo bank debits: ${payments.length}`);
  console.log(`[audit] ${chain.valid ? 'chain verified' : 'CHAIN BROKEN'}, ${chain.length} entries`);
  console.log(`[spend] ${live ? 'SDK-estimated' : 'mock'} total_cost_usd=${total.toFixed(6)} ledger=${JSON.stringify(await ledger.usage('aziz'))}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'DEMO_FAILED'); process.exitCode = 1; });
