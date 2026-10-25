import { describe, expect, it, vi } from 'vitest';
import { ChildProcess } from 'node:child_process';
import type { OwnedProcesses } from '../../../tools/demo/processes';
import { createAttackDemoProcess, resetCompany } from '../../../tools/demo/attack';
import { createLiveAnalyst, type LiveAnalyst } from '../attack-demo/live';
import { MemoryStateStore } from '../store';
import { MemoryUsageLedger } from '../agents/usage';
import { scriptedQuery } from '../agents/mock-query';

const config = (database: string) => ({ uri: 'ws://state.test', database, token: `private-${database}` });

describe('owned attack demo across company resets', () => {
  it('replaces only the attack child, after web installs each fresh company, without mutating web env', async () => {
    const events: string[] = [];
    const env = { STATE_STORE: 'spacetime', ATTACK_DEMO_LIVE: '1', SPACETIMEDB_DATABASE: 'boot' };
    let id = 0;
    const states = new Map(['boot', 'reset-1', 'reset-2'].map(database => [database, new MemoryStateStore()]));
    let analyst: LiveAnalyst;
    let prior = states.get('boot')!;
    const children = {
      start: vi.fn<OwnedProcesses['start']>((_command, _args, _log, childEnv = {}) => {
        events.push(`start:${childEnv.SPACETIMEDB_DATABASE}`);
        const state = states.get(childEnv.SPACETIMEDB_DATABASE!)!;
        analyst = createLiveAnalyst({ enabled: () => true, state: () => state, credential: () => 'test-only',
          ledger: new MemoryUsageLedger(), query: scriptedQuery(() => [
            { tool: 'record_attack_assessment', args: { proposal: 'Untrusted bank change requires review.' } },
          ], { costUsd: 0.0004 }) });
        const child = new ChildProcess();
        Object.assign(child, { taskId: ++id });
        return child;
      }),
      stop: vi.fn<OwnedProcesses['stop']>(async child => { events.push(`stop:${(child as ChildProcess & { taskId: number }).taskId}`); }),
    };
    const attack = createAttackDemoProcess({ children, env, loader: 'tsx', log: '/tmp/attack-test.log',
      ready: async () => { events.push('ready'); } });
    await attack.start(config('boot'));
    await analyst!('first attempt');
    for (const database of ['reset-1', 'reset-2']) {
      const result = await resetCompany({
        publish: async () => { events.push(`publish:${database}`); return config(database); },
        resetWeb: async next => {
          await prior.setLlmEnabled(false); // Web fences the old database on install.
          prior = states.get(next!.database)!;
          events.push(`web:${next?.database}`); return 'company ready';
        }, attack,
      });
      expect(result).toBe('company ready');
      expect((await analyst!('after reset')).provider).toBe('anthropic');
      await expect(analyst!('second attempt')).rejects.toMatchObject({ status: 429 });
    }
    expect(events).toEqual(['start:boot', 'ready', 'publish:reset-1', 'stop:1', 'web:reset-1', 'start:reset-1', 'ready',
      'publish:reset-2', 'stop:2', 'web:reset-2', 'start:reset-2', 'ready']);
    expect(children.start.mock.calls.map(call => call[3])).toEqual(['boot', 'reset-1', 'reset-2'].map(database =>
      expect.objectContaining({ STATE_STORE: 'spacetime', SPACETIMEDB_DATABASE: database, SPACETIMEDB_TOKEN: `private-${database}` })));
    expect(env.SPACETIMEDB_DATABASE).toBe('boot');
  });

  it('keeps mock analysis in memory and does not restart against a failed web reset', async () => {
    const children = { start: vi.fn<OwnedProcesses['start']>(() => new ChildProcess()), stop: vi.fn<OwnedProcesses['stop']>(async () => {}) };
    const ready = vi.fn(async () => {});
    const attack = createAttackDemoProcess({ children, env: { STATE_STORE: 'spacetime' }, loader: 'tsx', log: '/tmp/attack-test.log', ready });
    await attack.start(config('boot'));
    expect(children.start.mock.calls[0]?.[3]).toMatchObject({ STATE_STORE: 'memory' });
    await expect(resetCompany({ publish: async () => config('next'), attack,
      resetWeb: async () => { throw new Error('WEB_RESET_FAILED'); } })).rejects.toThrow('WEB_RESET_FAILED');
    expect(children.stop).toHaveBeenCalledOnce();
    expect(children.start).toHaveBeenCalledOnce();
  });
});
