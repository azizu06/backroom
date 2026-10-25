import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from './store';
import type { CallEscalation } from './store';

const VOICE = 'voice:collections';
const escalation = (id: string, callId: string): CallEscalation => ({ id, taskId: `call:${callId}`, callId, invoiceId: '1042',
  fromAgent: VOICE, seat: 'collections', toHuman: 'Dana', ruleIds: ['MAX_INSTALLMENTS'], evidenceRefs: ['audit-1', '1042'],
  policyVersion: 1, quote: { sentenceId: 's1', text: 'Ask Dana for an exception.' } });

describe('live voice call presence', () => {
  it('is on_call from call start, idle after the call, and online again on the next call', async () => {
    const store = new MemoryStateStore();
    await store.setCallPresence(VOICE, 'collections', true, 1_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'on_call', seatId: 'collections', heartbeatAt: 1_000 });
    await store.setCallPresence(VOICE, 'collections', false, 2_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'idle', heartbeatAt: 2_000 });
    await store.reapExpired(100_000);
    expect((await store.getAgent(VOICE))?.state).toBe('offline');
    await store.setCallPresence(VOICE, 'collections', true, 100_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'on_call', heartbeatAt: 100_000 });
    expect((await store.listAudit()).map(row => row.action)).toEqual([]);
  });

  it('a repeat call escalation refreshes the stale row from the first call instead of staying offline', async () => {
    const store = new MemoryStateStore();
    await store.createCallEscalation(escalation('e1', 'call-1'), 1_000);
    await store.reapExpired(100_000);
    expect((await store.getAgent(VOICE))?.state).toBe('offline');
    await store.createCallEscalation(escalation('e2', 'call-2'), 100_000);
    await store.reapExpired(110_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'walking', targetAnchor: 'Dana_desk', heartbeatAt: 100_000 });
  });

  it('keeps the walk to Dana while her decision is pending, then returns to the call', async () => {
    const store = new MemoryStateStore();
    await store.setCallPresence(VOICE, 'collections', true, 1_000);
    await store.createCallEscalation(escalation('e1', 'call-1'), 2_000);
    await store.setCallPresence(VOICE, 'collections', true, 30_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'walking', targetAnchor: 'Dana_desk', heartbeatAt: 30_000 });
    await store.expireEscalations(31_000, 'call-1');
    await store.setCallPresence(VOICE, 'collections', true, 32_000);
    expect(await store.getAgent(VOICE)).toMatchObject({ state: 'on_call', heartbeatAt: 32_000 });
    expect((await store.getAgent(VOICE))?.targetAnchor).toBeUndefined();
  });

  it('refuses lease workers, other seats and non-voice ids', async () => {
    const store = new MemoryStateStore();
    await store.registerAgent('collections-1', 'collections', 0);
    await expect(store.setCallPresence('collections-1', 'collections', true, 0)).rejects.toThrow('INVALID_CALL_PRESENCE');
    await store.setCallPresence(VOICE, 'collections', true, 0);
    await expect(store.setCallPresence(VOICE, 'payables', true, 0)).rejects.toThrow('INVALID_CALL_PRESENCE');
    await store.setCallPresence('voice:other', 'collections', false, 0);
    expect(await store.getAgent('voice:other')).toBeUndefined();
  });
});
