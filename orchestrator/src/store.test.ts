import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from './store';

describe('task lease reducers', () => {
  it('claims atomically, requeues expired work, and fences the old owner', async () => {
    const store = new MemoryStateStore();
    await store.registerAgent('old', 'payables', 0);
    await store.registerAgent('new', 'payables', 0);
    await store.enqueueTask({ id: 't1', seatId: 'payables', refs: ['invoice:1'], steps: [] });
    const [first, other] = await Promise.all([
      store.claimTask('old', 0, 10000), store.claimTask('new', 0, 10000),
    ]);
    expect(first?.leaseOwner).toBe('old');
    expect(other).toBeUndefined();
    await store.reapExpired(16000);
    expect((await store.getAgent('old'))?.state).toBe('offline');
    expect((await store.getTask('t1'))?.status).toBe('queued');
    await store.heartbeat('new', 16000);
    const recovered = await store.claimTask('new', 16000, 10000);
    expect(recovered?.leaseToken).not.toBe(first?.leaseToken);
    await expect(store.completeTask(first!, 'done', 16000)).rejects.toThrow('LEASE_LOST');
    await store.completeTask(recovered!, 'done', 16000);
    expect((await store.getTask('t1'))?.status).toBe('done');
  });
});

describe('append-only evidence and invoice transitions', () => {
  it('returns isolated snapshots and detects tampering via the audit hash chain', async () => {
    const store = new MemoryStateStore();
    const entry = { ts: 0, actor: 'code' as const, seat: 'collections' as const, action: 'call_client',
      ruleIds: ['CALL_PERMIT'], policyVersion: 3, refs: ['invoice:1'], route: 'code', latencyMs: 0, costUsd: 0 };
    const first = await store.appendAudit(entry);
    const second = await store.appendAudit({ ...entry, ts: 1 });
    expect(second.prevHash).toBe(first.hash);
    expect(second.seq).toBe(2);
    first.ruleIds.push('TAMPER');
    expect((await store.listAudit())[0]?.ruleIds).toEqual(['CALL_PERMIT']);
    const { hash, ...body } = (await store.listAudit())[0]!;
    const { hashAudit } = await import('./memory-store');
    expect(hashAudit(body)).toBe(hash);
    expect(hashAudit({ ...body, action: 'tampered' })).not.toBe(hash);
  });

  it('rejects invalid invoice jumps, stale writes, and premature state changes', async () => {
    const store = new MemoryStateStore();
    await store.registerAgent('a', 'payables', 0);
    await store.enqueueTask({ id: 't', seatId: 'payables', refs: ['invoice:1'], steps: [] });
    const lease = (await store.claimTask('a', 0, 10000))!;
    await store.insertInvoice({ id: 'invoice:1', kind: 'ap', state: 'received' });
    await expect(store.transitionInvoice(lease, 'invoice:1', 'received', 'paid', 0)).rejects.toThrow('INVALID_INVOICE_TRANSITION');
    await store.transitionInvoice(lease, 'invoice:1', 'received', 'extracted', 0);
    await expect(store.transitionInvoice(lease, 'invoice:1', 'received', 'extracted', 0)).rejects.toThrow('INVALID_INVOICE_TRANSITION');
    await expect(store.transitionInvoice(lease, 'invoice:1', 'extracted', 'matched', 10000)).rejects.toThrow('LEASE_LOST');
    await expect(store.setAgentState(lease, 'waiting', 0)).rejects.toThrow('INVALID_AGENT_TRANSITION');
  });
});

describe('heartbeat recovery', () => {
  it('cannot resurrect ownership by sending a late heartbeat before the reaper runs', async () => {
    const store = new MemoryStateStore();
    await store.registerAgent('a', 'payables', 0);
    await store.enqueueTask({ id: 't', seatId: 'payables', refs: [], steps: [] });
    const lease = (await store.claimTask('a', 0, 30000))!;
    await store.heartbeat('a', 16000);
    expect((await store.getTask('t'))?.status).toBe('queued');
    await expect(store.renewLease(lease, 16000, 30000)).rejects.toThrow('LEASE_LOST');
    expect((await store.listAudit())[0]).toMatchObject({ actor: 'system', action: 'lease_expired', ruleIds: ['LEASE_EXPIRED'] });
  });
});
