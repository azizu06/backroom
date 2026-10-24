import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('setup refreshes reused T1 tool and lifecycle URLs after the tunnel changes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'backroom-t1-'));
  try {
    mkdirSync(join(cwd, '.env.t1'));
    writeFileSync(join(cwd, '.env.t1/resources.json'), JSON.stringify({ tool_id: 'tool', webhook_id: 'hook', agent_id: 'agent' }));
    const mock = join(cwd, 'mock.mjs');
    writeFileSync(mock, `import {appendFileSync} from 'node:fs';
      globalThis.fetch = async (url, init) => {
        appendFileSync('requests.jsonl', JSON.stringify({url, method:init.method, body:JSON.parse(init.body)})+'\\n');
        return Response.json({});
      };`);
    const result = spawnSync(process.execPath, ['--import', mock, fileURLToPath(new URL('./t1.mjs', import.meta.url)), 'setup'], {
      cwd, encoding: 'utf8', env: { ...process.env, CARTESIA_API_KEY: 'test', CARTESIA_WEBHOOK_SECRET: 'new-secret', T1_PUBLIC_URL: 'https://new-tunnel.test' },
    });
    expect(result.status, result.stderr).toBe(0);
    const requests = readFileSync(join(cwd, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://api.cartesia.ai/agents/webhooks/hook', method: 'PATCH',
        body: expect.objectContaining({ url: 'https://new-tunnel.test/api/voice/cartesia', secret: 'new-secret' }) }),
      expect.objectContaining({ url: 'https://api.cartesia.ai/v1/agents/tools/tool', method: 'PATCH',
        body: expect.objectContaining({ api_schema: expect.objectContaining({ url: 'https://new-tunnel.test/api/tools/t1_echo',
          authentication: { mode: 'bearer', token: { type: 'secret', secret_value: 'new-secret' } } }) }) }),
    ]));
    expect(requests.every(request => request.method === 'PATCH')).toBe(true);
    expect(requests.find(request => request.url.endsWith('/tools/tool')).body).not.toHaveProperty('type');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
