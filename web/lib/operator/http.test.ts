import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createOperatorHTTP } from './http';
import { operatorSession } from './session';

const env = { DEMO_CONTROL_SECRET: 'private-host-key', DEMO_PORT: '3397' };
const origin = 'http://127.0.0.1:3397';
const request = (action: string, cookie = operatorSession(env, origin), from = origin, body = '{}') =>
  new Request(`${origin}/api/operator/${action}`, { method: 'POST', headers: { origin: from, cookie, 'content-type': 'application/json' }, body });

describe('operator HTTP actions', () => {
  it('does not execute without a session and own origin, or accept arbitrary commands', async () => {
    const store = new MemoryStateStore(); let executions = 0;
    const handle = createOperatorHTTP({ env: () => env, store: () => store, run: async () => { executions++; return {}; } });
    expect((await handle('reset', request('reset', ''))).status).toBe(401);
    expect((await handle('reset', request('reset', undefined, 'https://evil.example'))).status).toBe(403);
    expect((await handle('dial', request('dial'))).status).toBe(404);
    expect((await handle('reset', request('reset', undefined, origin, '{"command":"rm"}'))).status).toBe(400);
    expect(executions).toBe(0);
  });
  it('records each completed action and blocks concurrent reset/eval work', async () => {
    const store = new MemoryStateStore(); let finish!: () => void;
    const handle = createOperatorHTTP({ env: () => env, store: () => store,
      run: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { bank: 'mock' }; } });
    const running = handle('reset', request('reset'));
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    expect((await handle('eval', request('eval'))).status).toBe(409);
    finish();
    const response = await running;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ bank: 'mock' });
    expect((await store.listAudit()).filter(row => row.action === 'operator_reset').map(row => row.inputs?.phase)).toEqual(['started', 'completed']);
    expect(body.auditHref).toMatch(/^\/audit\?entry=/);
  });
  it('redacts adapter failures and records a failed receipt without fabricating success', async () => {
    const store = new MemoryStateStore();
    const handle = createOperatorHTTP({ env: () => env, store: () => store, run: async () => { throw new Error('secret-url?key=never-print'); } });
    const response = await handle('health', request('health'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('never-print');
    expect((await store.listAudit()).at(-1)?.inputs?.phase).toBe('failed');
  });
  it('keeps the OFF switch available while a model action is running', async () => {
    const store = new MemoryStateStore(); let finish!: () => void;
    const handle = createOperatorHTTP({ env: () => env, store: () => store, run: async action => {
      if (action === 'llm_off') { await store.setLlmEnabled(false); return { llmEnabled: false }; }
      await new Promise<void>(resolve => { finish = resolve; }); return {};
    } });
    const running = handle('burst', request('burst'));
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    expect((await handle('llm_off', request('llm_off'))).status).toBe(200);
    expect(store.llmEnabled).toBe(false);
    expect((await handle('reset', request('reset'))).status).toBe(409);
    finish(); await running;
  });
});
