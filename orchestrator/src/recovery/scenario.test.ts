import { describe, expect, it } from 'vitest';
import { runRecovery, type KillPoint } from './scenario';
import { hashAudit } from '../memory-store';

// Three real worker starts can each take about 10 s on Windows; keep the lease and crash windows unchanged.
const recoveryTimeoutMs = process.platform === 'win32' ? 60000 : 10000;

describe('real SIGKILL recovery demo (simulated independent services)', () => {
  it.each<KillPoint>(['before_payment', 'after_payment', 'after_receipt', 'after_cursor'])(
    'finishes a batch after a double kill at %s', async killPoint => {
      const result = await runRecovery({ batchSize: 3, killAfter: 1, kills: 2, killPoint,
        leaseMs: 600, heartbeatMs: 100, timeoutMs: recoveryTimeoutMs });
      expect(result.payments).toBe(3);
      expect(result.kills).toBe(2);
      expect(result.signals.slice(0, 2)).toEqual(['SIGKILL', 'SIGKILL']);
      expect(result.before).toHaveLength(2);
      expect(result.after.every(entry => entry.actor === 'code')).toBe(true);
      expect(result.tasks.map(task => task.status)).toEqual(['done', 'done', 'done']);
      expect(result.tasks.map(task => task.cursor)).toEqual([1, 1, 1]);
      expect(result.tasks.every(task => !task.leaseOwner && !task.leaseExpiresAt)).toBe(true);
      expect(result.after.filter(entry => entry.action === 'task_resumed').map(entry => entry.inputs?.cursor))
        .toEqual(killPoint === 'after_cursor' ? [1, 1] : [0, 0]);
      let previous = '0'.repeat(64);
      for (const { hash, ...entry } of result.after) {
        expect(entry.prevHash).toBe(previous);
        expect(hashAudit(entry)).toBe(hash);
        previous = hash;
      }
    }, recoveryTimeoutMs + 2000);

  it('rejects a kill configuration that cannot occur in the batch', async () => {
    await expect(runRecovery({ batchSize: 2, killAfter: 2, kills: 2 })).rejects.toThrow('INVALID_RECOVERY_OPTIONS');
  });
});
