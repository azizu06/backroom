import { runRecovery, type KillPoint } from './scenario';

// Environment keeps the same command usable from pnpm and on stage.
try {
  await runRecovery({
    batchSize: Number(process.env.RECOVERY_BATCH_SIZE ?? 4),
    killAfter: Number(process.env.RECOVERY_KILL_AFTER ?? 2),
    kills: Number(process.env.RECOVERY_KILLS ?? 1),
    killPoint: (process.env.RECOVERY_KILL_POINT ?? 'after_payment') as KillPoint,
    leaseMs: Number(process.env.RECOVERY_LEASE_MS ?? 1200),
    heartbeatMs: Number(process.env.RECOVERY_HEARTBEAT_MS ?? 200),
    log: console.log,
  });
} catch (error) {
  console.error(`FAIL recovery: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
