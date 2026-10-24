import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { localSpacetime } from '../../../tools/demo/spacetime';
import { OwnedProcesses } from '../../../tools/demo/processes';
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

it('preserves existing shared-state attachment while refusing mixed hosted reset modes', () => {
  expect(demoDatabaseTarget({ BACKROOM_DEMO: '1', DEMO_STATE_REMOTE: '1', SPACETIMEDB_DATABASE: 'shared-judge' }).mode).toBe('local');
  expect(() => demoDatabaseTarget({ BACKROOM_DEMO: '1', DEMO_STATE_REMOTE: '1', DEMO_SPACETIME: 'maincloud', DEMO_MAINCLOUD: '1' })).toThrow('DEMO_CONFLICTING_STATE_MODES');
});


it('rotates fresh marked Maincloud databases without starting a local server or deleting old state', async () => {
  const scratch = resolve('.demo');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'reset-test-'));
  mkdirSync(join(root, '.demo'));
  const config = join(root, 'publisher.toml');
  writeFileSync(config, 'spacetimedb_token = "test-private-token"');
  const children = new OwnedProcesses(root, {});
  const commands: string[][] = [];
  vi.spyOn(children, 'run').mockImplementation(async (_cmd, args, log) => {
    commands.push(args);
    if (args.includes('--version')) writeFileSync(log, 'spacetime 2.13.0');
  });
  vi.spyOn(children, 'start').mockImplementation(() => { throw new Error('must not start a local server'); });
  try {
    const db = localSpacetime(root, { BACKROOM_DEMO: '1', DEMO_SPACETIME: 'maincloud', DEMO_MAINCLOUD: '1', SPACETIME_CONFIG: config }, children);
    await db.start();
    const first = await db.publish(), second = await db.publish();
    expect(first.database).toMatch(/^backroom-demo-[0-9]+-[0-9a-f]{6}$/);
    expect(second.database).not.toBe(first.database);
    expect(first.uri).toBe('wss://maincloud.spacetimedb.com');
    const publishes = commands.filter(args => args.includes('publish'));
    expect(publishes).toHaveLength(2);
    for (const args of publishes) {
      expect(args[args.indexOf('--server') + 1]).toBe('https://maincloud.spacetimedb.com');
      expect(args).not.toContain('--delete-data');
      expect(args).not.toContain('test-private-token');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
