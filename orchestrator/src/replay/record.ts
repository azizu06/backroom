import { createHash } from 'node:crypto';
import { verifyChain } from '../audit';
import type { AuditEntry, StateStore } from '../store';
import type { ReplayFrame, ReplayHeader, ReplayRecording } from './types';

const digest = (lines: string[]) => createHash('sha256').update(lines.join('\n') + '\n').digest('hex');
const mutations = new Set(['savePolicyLimits', 'setLlmEnabled', 'registerAgent', 'heartbeat', 'enqueueTask',
  'claimTask', 'renewLease', 'reapExpired', 'setAgentState', 'setAgentTarget', 'pauseTask', 'advanceTask',
  'completeTask', 'createEscalation', 'createCallEscalation', 'decideEscalation', 'expireEscalations',
  'appendAudit', 'appendAudits', 'reservePayment', 'recordPayment', 'insertInvoice', 'transitionInvoice']);

/** Trusted local capture adapter. Never logs reducer arguments, credentials or transport payloads.
 * StateStore has no list-agents/tasks API: track IDs observed at registration/enqueue, then read them.
 * Each phase must attach before its first write. Mutations are serialized only in recording mode.
 */
export function createReplayRecorder(options: { name: string; now?: () => number; paceMs?: number }) {
  const now = options.now ?? Date.now;
  const started = now();
  const header: ReplayHeader = { kind: 'backroom-replay', version: 1, name: options.name,
    recordedAt: new Date(started).toISOString(),
    provenance: 'pnpm demo:core · synthetic Northfield · scripted call · fake sponsor transports · software test passkey' };
  const frames: ReplayFrame[] = [];
  return {
    attach(store: StateStore, phase: string): StateStore {
      const agents = new Set<string>(), tasks = new Set<string>(), escalations = new Set<string>();
      let since = 0;
      let queue: Promise<unknown> = Promise.resolve();
      return new Proxy(store, { get(target, key) {
        const method = Reflect.get(target, key, target);
        if (typeof method !== 'function') return method;
        if (!mutations.has(String(key))) return method.bind(target);
        return (...args: unknown[]) => {
          const job = queue.then(async () => {
            const result = await method.apply(target, args);
            if (key === 'registerAgent') agents.add(args[0] as string);
            if (key === 'enqueueTask') tasks.add((args[0] as { id: string }).id);
            if (key === 'createEscalation' || key === 'createCallEscalation') escalations.add((result as { id: string }).id);
            const taskRows = (await Promise.all([...tasks].map(id => target.getTask(id)))).filter(row => row !== undefined);
            for (const task of taskRows) if (task.escalationId) escalations.add(task.escalationId);
            const audit = await target.listAudit(since);
            since = audit.at(-1)?.seq ?? since;
            frames.push(structuredClone({ kind: 'frame', index: frames.length, atMs: Math.max(0, now() - started), phase,
              operation: String(key), state: {
                agents: (await Promise.all([...agents].map(id => target.getAgent(id)))).filter(row => row !== undefined),
                tasks: taskRows,
                escalations: (await Promise.all([...escalations].map(id => target.getEscalation(id)))).filter(row => row !== undefined),
                policy: await target.getPolicy(), llmEnabled: target.llmEnabled,
              }, audit } satisfies ReplayFrame));
            if (options.paceMs) await new Promise(resolve => setTimeout(resolve, options.paceMs));
            return result;
          });
          queue = job.catch(() => undefined);
          return job;
        };
      } });
    },
    toJsonl() {
      const lines = [JSON.stringify(header), ...frames.map(frame => JSON.stringify(frame))];
      return [...lines, JSON.stringify({ kind: 'end', frameCount: frames.length,
        durationMs: frames.at(-1)?.atMs ?? 0, sha256: digest(lines) })].join('\n') + '\n';
    },
  };
}

/** Local bundled recordings only. Verify the entire file plus each phase's original audit chain.
 * The digest detects accidental edits/truncation, not malicious replacement of file AND digest.
 */
export function parseReplay(jsonl: string): ReplayRecording {
  const fail = () => { throw new Error('INVALID_REPLAY'); };
  try {
    const lines = jsonl.trimEnd().split('\n');
    const header = JSON.parse(lines[0]!) as ReplayHeader;
    const end = JSON.parse(lines.at(-1)!);
    const frames = lines.slice(1, -1).map(line => JSON.parse(line) as ReplayFrame);
    if (header.kind !== 'backroom-replay' || header.version !== 1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(header.name)
      || !Number.isFinite(Date.parse(header.recordedAt)) || typeof header.provenance !== 'string'
      || end.kind !== 'end' || !frames.length || end.frameCount !== frames.length
      || end.sha256 !== digest(lines.slice(0, -1)) || end.durationMs !== frames.at(-1)!.atMs) fail();
    const chains = new Map<string, AuditEntry[]>();
    let previous = 0;
    for (const [index, frame] of frames.entries()) {
      if (frame.kind !== 'frame' || frame.index !== index || !Number.isSafeInteger(frame.atMs) || frame.atMs < previous
        || typeof frame.phase !== 'string' || typeof frame.operation !== 'string' || !Array.isArray(frame.audit)
        || !Array.isArray(frame.state.agents) || !Array.isArray(frame.state.tasks) || !Array.isArray(frame.state.escalations)
        || typeof frame.state.llmEnabled !== 'boolean' || !frame.state.policy.badges) fail();
      const chain = [...(chains.get(frame.phase) ?? []), ...frame.audit];
      if (!verifyChain(chain).valid) fail();
      chains.set(frame.phase, chain); previous = frame.atMs;
    }
    return { header, frames, durationMs: end.durationMs };
  } catch { return fail(); }
}
