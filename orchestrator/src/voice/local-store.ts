import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { GatewayError, type GatewayCall, type GatewayStore } from '../../../web/lib/gateway/store';

/** Local demo adapter only; one writer process. Preserves gateway atomicity and
 * global delivery-ID uniqueness across restarts. Replace with stream C's DB
 * adapter for a hosted/multi-process deployment. Contains no phone numbers. */
export class LocalGatewayStore implements GatewayStore {
  private calls: GatewayCall[];
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {
    this.calls = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as GatewayCall[] : [];
  }
  private run<T>(work: (calls: GatewayCall[]) => T | Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const calls = structuredClone(this.calls), value = await work(calls);
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(calls), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file); this.calls = calls;
      return structuredClone(value);
    });
    this.tail = result.catch(() => undefined); return result;
  }
  add(call: GatewayCall) { return this.run(calls => {
    if (calls.some(c => c.callId === call.callId)) throw new Error('CALL_EXISTS');
    calls.push(structuredClone(call));
  }); }
  clientStopped(clientId: string) { return this.run(calls => calls.some(call => call.clientId === clientId && call.status !== 'active')); }
  transact<T>(callId: string, work: (call: GatewayCall) => T | Promise<T>): Promise<T> {
    return this.run(async calls => {
      const call = calls.find(c => c.callId === callId);
      if (!call) throw new GatewayError(404, 'CALL_NOT_FOUND');
      const value = await work(call);
      if (calls.some(c => c.callId !== callId && Object.keys(call.deliveries).some(id => Object.hasOwn(c.deliveries, id)))) throw new GatewayError(409, 'WEBHOOK_ID_REUSED');
      return value;
    });
  }
}
