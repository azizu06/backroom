/** Demo-only IPC adapter: state and simulated payments outlive this killable process. */
import { SeatWorker, type Effects, type StateStore } from '../index';

interface Reply { id: number; result?: unknown; error?: string }
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
process.on('message', (message: Reply) => {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.result);
});
process.on('disconnect', () => {
  for (const request of pending.values()) request.reject(new Error('STATE_SERVICE_DISCONNECTED'));
  pending.clear();
});
function remote<T extends object>(target: 'store' | 'effects'): T {
  return new Proxy({}, { get: (_object, method: string) => (...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      // AbortSignal is process-local; the simulated provider completes immediately.
      const wireArgs = target === 'effects' ? args.map(value => {
        const { signal: _signal, ...request } = value as Record<string, unknown>;
        return request;
      }) : args;
      process.send!({ id, target, method, args: wireArgs }, error => {
        if (error) { pending.delete(id); reject(error); }
      });
    }) }) as T;
}
const worker = new SeatWorker({ id: process.argv[2]!, seat: 'payables',
  store: remote<StateStore>('store'), effects: remote<Effects>('effects'),
  leaseMs: Number(process.argv[3]), heartbeatMs: Number(process.argv[4]),
});
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
try {
  await worker.run(controller.signal);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
