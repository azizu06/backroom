import { describe, expect, it } from 'vitest';
import { MemoryStateStore, type AuditInput } from './store';
import { AuditLog, AUDIT_GENESIS_HASH, canonicalAuditJson, verifyChain } from './audit';

const input: AuditInput = { ts: 123, actor: 'code', seat: 'payables', action: 'pay_invoice',
  ruleIds: ['DUPLICATE_INVOICE'], policyVersion: 1, refs: ['invoice:4419'],
  route: 'code', latencyMs: 0, costUsd: 0 };

describe('canonical audit chain', () => {
  it('matches an independent Python hashlib vector for the canonical genesis entry', async () => {
    const entry = await new MemoryStateStore().appendAudit(input);
    expect(entry.hash).toBe('b5a9034187da2de1eed453ae3d62843aec66e9ad335bb0792789d2ba5900fb58');
  });
  it('replays identical evidence with reordered nested keys to identical hashes', async () => {
    const first = new MemoryStateStore();
    const replay = new MemoryStateStore();
    const a = await first.appendAudit({ ...input, inputs: { z: 2, a: { right: 1, left: 'é' } } });
    const b = await replay.appendAudit({ ...input, inputs: { a: { left: 'é', right: 1 }, z: 2 } });
    expect(b.hash).toBe(a.hash);
  });

  it('reports the first broken sequence when an entry is edited', async () => {
    const store = new MemoryStateStore();
    for (let ts = 0; ts < 3; ts++) await store.appendAudit({ ...input, ts });
    expect(await store.verifyAuditChain()).toMatchObject({ valid: true, length: 3, firstBrokenSeq: null });
    const entries = await store.listAudit();
    entries[1]!.action = 'tampered';
    entries[2]!.ruleIds = [];
    expect(verifyChain(entries)).toMatchObject({ valid: false, firstBrokenSeq: 2, reason: 'HASH_MISMATCH' });
  });

  it('reads entries after an exclusive cursor and fetches an isolated entry by id', async () => {
    const store = new MemoryStateStore();
    const entries = await Promise.all([store.appendAudit(input), store.appendAudit(input), store.appendAudit(input)]);
    expect((await store.listAudit(1)).map(entry => entry.seq)).toEqual([2, 3]);
    expect(await store.listAudit(3)).toEqual([]);
    const found = (await store.getAudit(entries[1]!.id))!;
    found.refs.push('tamper');
    expect(await store.getAudit(found.id)).toEqual(entries[1]);
    expect(await store.getAudit('missing')).toBeUndefined();
  });

  it('restores a verified log, replays inputs identically, and continues the same chain', async () => {
    const store = new MemoryStateStore();
    await store.appendAudit(input);
    await store.appendAudit({ ...input, actor: 'local_model', route: 'local', inputs: { model: 'qwen3:8b' } });
    const saved = await store.listAudit();
    const restored = new AuditLog(saved);
    const replay = new AuditLog();
    for (const { hash, prevHash, seq, ...entry } of saved) replay.append(entry);
    expect(replay.list()).toEqual(saved);
    expect(restored.append(input)).toEqual(await store.appendAudit(input));
    saved[0]!.action = 'tamper';
    expect(() => new AuditLog(saved)).toThrow('AUDIT_CHAIN_BROKEN:1');
    expect(restored.verifyChain().valid).toBe(true);
  });

  it('rejects an invalid batch without appending a partial prefix', async () => {
    const store = new MemoryStateStore();
    await expect(store.appendAudits([input, { ...input, inputs: { invalid: NaN } }])).rejects.toThrow('INVALID_AUDIT_JSON');
    expect(await store.verifyAuditChain()).toEqual({ valid: true, length: 0, headHash: AUDIT_GENESIS_HASH, firstBrokenSeq: null });
    await store.appendAudits([{ ...input, id: 'gateway-uuid' }, input]);
    await expect(store.appendAudits([input, { ...input, id: 'gateway-uuid' }])).rejects.toThrow('AUDIT_ID_CONFLICT');
    expect((await store.listAudit()).map(entry => entry.seq)).toEqual([1, 2]);
  });

  it('uses lexical keys, preserves array order, and strips only undefined object fields', () => {
    expect(canonicalAuditJson({ z: undefined, 2: 'two', 10: 'ten', a: [true, null, '\n'] }))
      .toBe('{"10":"ten","2":"two","a":[true,null,"\\n"]}');
    expect(() => canonicalAuditJson({ date: new Date() })).toThrow('INVALID_AUDIT_JSON');
    expect(() => canonicalAuditJson({ array: [undefined] })).toThrow('INVALID_AUDIT_JSON');
  });

  it.each(['seq', 'id', 'prevHash', 'hash'] as const)('detects a broken %s before later records', async field => {
    const store = new MemoryStateStore();
    await store.appendAudits([input, input, input]);
    const entries = await store.listAudit();
    Object.assign(entries[1]!, { [field]: field === 'seq' ? 999 : 'tamper' });
    expect(verifyChain(entries)).toMatchObject({ valid: false, firstBrokenSeq: 2 });
  });
});
