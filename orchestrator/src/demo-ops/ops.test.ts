import { describe, expect, it } from 'vitest';
import { demoDatabaseTarget } from './database';
import { preflight } from './preflight';

describe('demo database safety', () => {
  it('refuses unmarked, unknown and non-demo targets before any network', () => {
    expect(() => demoDatabaseTarget({})).toThrow('DEMO_MARKER_REQUIRED');
    expect(() => demoDatabaseTarget({ BACKROOM_DEMO: '1', DEMO_SPACETIME: 'prod' })).toThrow('DEMO_INVALID_SPACETIME');
    expect(() => demoDatabaseTarget({ BACKROOM_DEMO: '1', SPACETIMEDB_DATABASE: 'customers' })).toThrow('DEMO_NON_DEMO_DATABASE_REFUSED');
    expect(() => demoDatabaseTarget({ BACKROOM_DEMO: '1', DEMO_SPACETIME: 'maincloud' })).toThrow('DEMO_MAINCLOUD_OPT_IN_REQUIRED');
  });
  it('selects only loopback or the fixed Maincloud service', () => {
    expect(demoDatabaseTarget({ BACKROOM_DEMO: '1' }).uri).toBe('ws://127.0.0.1:3115');
    expect(demoDatabaseTarget({ BACKROOM_DEMO: '1', DEMO_SPACETIME: 'maincloud', DEMO_MAINCLOUD: '1' }).uri).toBe('wss://maincloud.spacetimedb.com');
  });
});

it('prints all dependencies when the host is down and never exposes provider errors', async () => {
  const rows = await preflight({ CARTESIA_API_KEY: 'private-key', NESSIE_API_KEY: 'private-bank', NESSIE_ACCOUNT_ID: 'account' }, undefined,
    async () => { throw new Error('private-key provider error'); });
  expect(rows.map(row => row.name)).toEqual(['Orchestrator', 'SpacetimeDB', 'Web', 'Cartesia', 'Nessie', 'GX10 Ollama']);
  expect(rows.every(row => !row.ok)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('private-');
});

it('requires authenticated reads and the configured Ollama model; never makes POST requests', async () => {
  const calls: RequestInit[] = [];
  const rows = await preflight({ CARTESIA_API_KEY: 'key', NESSIE_API_KEY: 'bank', NESSIE_ACCOUNT_ID: 'account' },
    { stateStore: 'spacetime', llmEnabled: false, voice: false, workersHealthy: true }, async (url, init) => {
      calls.push(init!);
      return String(url).includes('/models') ? Response.json({ data: [{ id: 'other-model' }] })
        : new Response('', { status: String(url).includes('cartesia') ? 401 : 200 });
    });
  expect(rows.find(row => row.name === 'Cartesia')?.ok).toBe(false);
  expect(rows.find(row => row.name === 'GX10 Ollama')?.ok).toBe(false);
  expect(rows.find(row => row.name === 'SpacetimeDB')?.ok).toBe(true);
  expect(calls.every(init => !init.method && init.redirect === 'error' && init.signal)).toBe(true);
});
