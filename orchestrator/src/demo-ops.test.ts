import { describe, expect, it } from 'vitest';
import { probeDependencies } from '../../tools/demo/health';

describe('demo dependency health', () => {
  it('reports actual OFF and missing integrations without any live network', async () => {
    const calls: string[] = [];
    const rows = await probeDependencies({ env: {}, status: { llmEnabled: false, stateStore: 'memory', voice: false },
      fetch: async url => { calls.push(String(url)); throw new Error('secret provider detail'); } });
    expect(rows.find(row => row.name === 'LLM OFF')).toMatchObject({ ok: true, detail: 'OFF; code paths remain active' });
    expect(rows.find(row => row.name === 'SpacetimeDB')).toMatchObject({ ok: false });
    expect(rows.find(row => row.name === 'Cartesia key')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain('secret provider detail');
  });
});

it('bounded live probes hide credential URLs and require successful responses', async () => {
  const rows = await probeDependencies({ env: { CARTESIA_API_KEY: 'private-cartesia', NESSIE_API_KEY: 'private-nessie',
    NESSIE_ACCOUNT_ID: 'account', DEMO_PUBLIC_URL: 'https://demo.example' }, live: true,
    status: { llmEnabled: true, stateStore: 'memory', voice: true },
    fetch: async url => String(url).includes('nessie') ? new Response('', { status: 403 }) : new Response('{}') });
  expect(rows.find(row => row.name === 'Nessie')).toMatchObject({ ok: false, detail: 'HTTP 403' });
  expect(rows.find(row => row.name === 'Tunnel')).toMatchObject({ ok: true });
  expect(rows.find(row => row.name === 'LLM OFF')).toMatchObject({ ok: false });
  expect(JSON.stringify(rows)).not.toContain('private-');
});
