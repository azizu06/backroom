import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from '../store';
import { createReplayRecorder, parseReplay } from './record';

describe('run recording', () => {
  it('retains intermediate agent targets, ordered audits and independently verified phase chains', async () => {
    let time = 1000;
    const recorder = createReplayRecorder({ name: 'test', now: () => time });
    const store = recorder.attach(new MemoryStateStore(), 'collections');
    await store.registerAgent('alex', 'collections', time);
    await store.enqueueTask({ id: 'invoice', seatId: 'collections', refs: [], steps: [] });
    const lease = (await store.claimTask('alex', time, 12000))!;
    time += 100;
    await store.setAgentTarget(lease, 'dana_desk', time);
    time += 100;
    await store.setAgentTarget(lease, 'collections_desk', time);
    await store.appendAudit({ ts: time, actor: 'code', seat: 'collections', action: 'recorded', ruleIds: [],
      policyVersion: 1, refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
    const recording = parseReplay(recorder.toJsonl());
    expect(recording.frames.find(frame => frame.atMs === 100)?.state.agents[0]?.targetAnchor).toBe('dana_desk');
    expect(recording.frames.at(-1)?.state.agents[0]?.targetAnchor).toBe('collections_desk');
    expect(recording.frames.flatMap(frame => frame.audit)).toEqual(await store.listAudit());
    expect(recording.durationMs).toBe(200);
  });
});

it('rejects truncation, changed state, and a broken audit chain even with a recomputed file digest', async () => {
  const { createHash } = await import('node:crypto');
  const recorder = createReplayRecorder({ name: 'integrity' });
  const store = recorder.attach(new MemoryStateStore(), 'one');
  await store.registerAgent('sam', 'payables', 1000);
  await store.appendAudit({ ts: 1000, actor: 'code', seat: 'payables', action: 'held', decision: 'DENY',
    ruleIds: ['BANK_CHANGE_HOLD'], policyVersion: 1, refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
  const lines = recorder.toJsonl().trimEnd().split('\n');
  expect(() => parseReplay(lines.slice(0, -1).join('\n'))).toThrow('INVALID_REPLAY');
  expect(() => parseReplay(recorder.toJsonl().replace('"state":"idle"', '"state":"working"'))).toThrow('INVALID_REPLAY');
  const frame = JSON.parse(lines.at(-2)!);
  frame.audit[0].decision = 'ALLOW';
  lines[lines.length - 2] = JSON.stringify(frame);
  const end = JSON.parse(lines.at(-1)!);
  end.sha256 = createHash('sha256').update(lines.slice(0, -1).join('\n') + '\n').digest('hex');
  lines[lines.length - 1] = JSON.stringify(end);
  expect(() => parseReplay(lines.join('\n'))).toThrow('INVALID_REPLAY');
});

it('records independent genesis chains without renumbering phase-local audit ids', async () => {
  const recorder = createReplayRecorder({ name: 'phases', now: () => 1000 });
  for (const phase of ['call', 'inbox']) {
    const store = recorder.attach(new MemoryStateStore(), phase);
    await store.appendAudit({ ts: 1000, actor: 'code', seat: 'collections', action: phase,
      policyVersion: 1, ruleIds: [], refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
  }
  const recording = parseReplay(recorder.toJsonl());
  expect(recording.frames.flatMap(frame => frame.audit).map(row => row.id)).toEqual(['audit:1', 'audit:1']);
  expect(recording.frames.map(frame => frame.phase)).toEqual(['call', 'inbox']);
});

it('records through the SpacetimeStateStore public adapter with mocked transport', async () => {
  const { SpacetimeStateStore } = await import('../spacetime-store');
  const engine = new MemoryStateStore();
  const durable = new SpacetimeStateStore({ transport: {
    ready: Promise.resolve(), close() {},
    onControl(listener) { listener({ connected: true, enabled: true, generation: 0n }); return () => {}; },
    async invoke(method, values) {
      const fn = engine[method as keyof MemoryStateStore];
      if (typeof fn !== 'function') throw new Error('UNEXPECTED_TRANSPORT_METHOD');
      return Reflect.apply(fn, engine, values);
    },
  } });
  try {
    const recorder = createReplayRecorder({ name: 'durable-test' });
    const store = recorder.attach(durable, 'call');
    await store.registerAgent('alex', 'collections', 1000);
    const recording = parseReplay(recorder.toJsonl());
    expect(recording.frames[0]?.state.agents[0]?.id).toBe('alex');
    expect(recording.frames[0]?.audit).toEqual(await durable.listAudit());
    expect(recording.frames[0]?.state.llmEnabled).toBe(true);
  } finally { await durable.close(); }
});
