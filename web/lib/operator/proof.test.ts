import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStateStore } from '@backroom/orchestrator';
import { collectProofResult } from './actions';
import { createOperatorHTTP } from './http';
import { operatorSession } from './session';

describe('failed operator proof receipts', () => {
  it.each(['eval', 'scoreboard'])('retains %s evidence and exit status while auditing failure', async action => {
    const directory = await mkdtemp(join(tmpdir(), 'backroom-proof-'));
    try {
      const report = action === 'scoreboard' ? join(directory, 'scoreboard.md') : undefined;
      const store = new MemoryStateStore();
      const env = { DEMO_PORT: '3397', DEMO_CONTROL_SECRET: 'test-only-host-key' };
      const origin = 'http://127.0.0.1:3397';
      const handle = createOperatorHTTP({ env: () => env, store: () => store, run: async () => {
        const script = report ? 'require("node:fs").writeFileSync(process.argv[1], "Scoreboard: bank change failed"); process.exitCode = 1;'
          : 'console.error("private-upstream-token"); console.log("Answer-key mismatch: C03"); process.exitCode = 1;';
        return collectProofResult(spawn(process.execPath, ['-e', script, ...(report ? [report] : [])], { stdio: ['ignore', 'pipe', 'ignore'] }), report);
      } });
      const response = await handle(action, new Request(`${origin}/api/operator/${action}`, { method: 'POST',
        headers: { origin, cookie: operatorSession(env, origin), 'content-type': 'application/json' }, body: '{}' }));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.result).toMatchObject({ exitCode: 1, failed: true });
      expect(body.result.output).toContain(action === 'eval' ? 'Answer-key mismatch: C03' : 'Scoreboard: bank change failed');
      expect(JSON.stringify(body)).not.toContain('private-upstream-token');
      expect(body.auditHref).toMatch(/^\/audit\?entry=/);
      expect((await store.listAudit()).at(-1)?.inputs?.phase).toBe('failed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
