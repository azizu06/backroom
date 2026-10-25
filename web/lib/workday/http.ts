import { getStateStore, type StateStore } from '@backroom/orchestrator';
import { demoAgentsEnabled, getInboxAgents } from '../demo/agents';
import { createInboxHTTP } from '../inbox/http';
import { inboxPresets } from '../inbox/presets';
import { createAttackDemoProxy } from '../attack-demo/proxy';
import { operatorOriginAllowed, operatorSessionValid } from '../operator/session';
import { hostSignedIn } from '../operator/sign-in';
import { createWorkdayBatch } from './batch';

type WorkdayCase = { id: string; label: string; caseId: string };
const root = globalThis as typeof globalThis & { backroomWorkday?: { control: StateStore; batch: ReturnType<typeof createWorkdayBatch>; host: ReturnType<typeof getInboxAgents>; cases: WorkdayCase[] } };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function resetWorkday() {
  const prior = root.backroomWorkday;
  await prior?.batch.stop();
  if (root.backroomWorkday === prior) root.backroomWorkday = undefined;
}
function workday(origin: string) {
  const control = getStateStore();
  if (root.backroomWorkday?.control === control) return root.backroomWorkday.batch;
  const host = getInboxAgents();
  const cases: WorkdayCase[] = [];
  const attack = createAttackDemoProxy({ origin: () => origin, secret: () => process.env.TOOL_GATEWAY_SECRET,
    baseUrl: process.env.ATTACK_DEMO_BASE_URL, allowLive: () => false });
  const batch = createWorkdayBatch({ control, ledger: host.ledger, enabled: () => demoAgentsEnabled() && getStateStore() === control,
    drain: host.drain,
    async submit(id) {
      if (id === 'bc-lookalike') {
        // Use the same Attack assessment route as the Attack panel, always without paid inference.
        const response = await attack(new Request(`${origin}/api/attack-demo`, { method: 'POST',
          headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: 'lookalike-vendor', mode: 'mock' }) }));
        if (!response.ok) throw new Error('Attack service unavailable. Workday stopped; review the recorded invoice decisions.');
        const result = await response.json();
        if (result.moneyMoved !== false || result.paymentAttempts !== 0 || result.decision?.kind === 'ALLOW') throw new Error('Attack did not return a safe hold. Workday stopped.');
        await control.appendAudit({ ts: Date.now(), actor: 'code', seat: 'vendor_onboarding', action: 'workday_attack_held',
          decision: result.decision.kind, ruleIds: result.decision.ruleIds, policyVersion: result.decision.policyVersion,
          refs: [result.caseId], route: 'code', latencyMs: 0, costUsd: 0, inputs: { assessmentOnly: true, mode: 'mock', moneyMoved: false } });
      }
      // Frozen Northfield facts, exactly as recognized by /api/inbox. No model extraction cost outside the ledger.
      const preset = inboxPresets.find(row => row.id === id)!;
      const form = new FormData();
      for (const [key, value] of Object.entries({ presetId: preset.id, kind: preset.kind, text: preset.text, senderDomain: preset.senderDomain })) form.set(key, value);
      const label = id === 'bc-lookalike' ? 'CASE-4471' : `INV-${id}`;
      const inbox = createInboxHTTP({ store: () => control, origin: () => origin, paymentMode: 'hold', caseDisplayId: label, agents: input => host.submit(input) });
      const response = await inbox(new Request(`${origin}/api/inbox`, { method: 'POST', headers: { origin }, body: form }));
      if (!response.ok) throw new Error('Inbox could not record a workday decision. Review the audit before resetting.');
      const receipt = await response.json();
      cases.push({ id, label, caseId: `agent:${receipt.id}` });
    },
  });
  root.backroomWorkday = { control, batch, host, cases };
  return batch;
}

/** Operator-only producer. No secrets, fields, company ids or budget overrides are accepted from the client. */
export async function workdayHTTP(request: Request) {
  if (!operatorOriginAllowed(request, process.env)) return json({ error: 'Origin rejected.' }, 403);
  if (!hostSignedIn(request) && !operatorSessionValid(request, process.env)) return json({ error: 'Sign in with the operator code.' }, 401);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Use GET or POST.' }, 405);
  if (request.method === 'GET') {
    const current = root.backroomWorkday;
    if (current?.control !== getStateStore()) return json({ status: 'ready', message: '', cases: [], rows: [] });
    const cases = await Promise.all(current.cases.map(async row => {
      const state = await current.host.store.getCase(row.caseId);
      const activation = state?.activations.at(-1);
      return { label: row.label, attack: row.id === 'bc-lookalike', status: state?.status ?? 'queued',
        role: activation?.role ?? 'intake', reason: state?.reason ?? '',
        steps: state?.activations.map(step => ({ role: step.role, status: step.status })) ?? [] };
    }));
    const labels = new Set(current.cases.map(row => row.label));
    const rows = (await current.host.store.listPublic()).filter(row => labels.has(row.caseDisplayId));
    return json({ ...current.batch.view(), cases, rows });
  }
  if (Number(request.headers.get('content-length') || 0) > 2) return json({ error: 'The workday accepts no input.' }, 400);
  // No body is needed. Cancel any unexpected stream without consuming unbounded input.
  if (request.body) { const reader = request.body.getReader(); const chunk = await reader.read(); await reader.cancel(); if (!chunk.done) return json({ error: 'The workday accepts no input.' }, 400); }
  if (!demoAgentsEnabled() || !getStateStore().llmEnabled) return json({ error: 'Agents are OFF. Turn agents ON before starting the workday.' }, 409);
  try {
    const result = await workday(request.headers.get('origin')!).start();
    return json(result, result.started ? 202 : result.status === 'ready' ? 409 : 200);
  } catch { return json({ error: 'The agent host or usage ledger is unavailable. Workday refused.' }, 503); }
}
