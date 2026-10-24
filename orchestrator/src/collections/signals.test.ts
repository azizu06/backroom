import { describe, expect, it, vi } from 'vitest';
import type { CrsEvidence } from '../integrations/crs';
import { MemoryStateStore } from '../memory-store';
import { SpacetimeStateStore, SpacetimeTransport } from '../spacetime-store';
import { recordSignals, signalPayload, signalsFromCrs, signalsFromHealth, type SignalRow } from './signals';
import type { HealthResult } from './types';

const evidence = (overrides: Partial<CrsEvidence> = {}): CrsEvidence => ({
  source: 'crs_sandbox', product: 'publicRecords', testIdentityId: 7,
  label: 'SANDBOX: test identity #7', checkedAt: '2026-10-24T12:30:00.000Z',
  responseHash: 'response-hash', summary: { bankruptcies: 0, judgments: 2, liens: 1 }, ...overrides,
});
const row = (): SignalRow => signalsFromCrs('client-1', evidence())[0]!;
const health = (): HealthResult => ({
  apifyRunId: 'run-1', signals: [
    { type: 'maps_status', value: 'operating', sourceUrl: 'https://example.com/maps', observedAt: '2026-10-24T12:00:00Z' },
    { type: 'phone_match', value: false, sourceUrl: 'https://example.com', observedAt: '2026-10-24T12:01:00Z' },
  ],
});

describe('signal conversion', () => {
  it('projects public records and fraud risk into separate numeric rows', () => {
    const rows = signalsFromCrs('client-1', evidence());
    expect(rows.map(({ type, value }) => ({ type, value }))).toEqual([
      { type: 'crs_bankruptcies', value: 0 }, { type: 'crs_judgments', value: 2 }, { type: 'crs_liens', value: 1 },
    ]);
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    for (const result of rows) {
      expect(result).toMatchObject({ source: 'crs_sandbox', subjectRef: 'client-1', observedAt: evidence().checkedAt,
        confidence: 1, label: evidence().label, evidenceRef: 'response-hash' });
    }
    expect(signalsFromCrs('client-1', evidence({ product: 'fraudRisk', summary: { fraudRiskScore: 82 } })))
      .toEqual([expect.objectContaining({ type: 'crs_fraud_risk_score', value: 82 })]);
    expect(signalsFromCrs('client-1', evidence({ summary: { bankruptcies: 1, liens: Infinity, judgments: NaN } })))
      .toEqual([expect.objectContaining({ type: 'crs_bankruptcies', value: 1 })]);
  });

  it('replays cached evidence byte-identically without duplicate rows', async () => {
    const store = new MemoryStateStore();
    const original = signalsFromCrs('client-1', evidence());
    const cached = signalsFromCrs('client-1', evidence({ cached: true, label: 'SANDBOX: test identity #7 (cached at 12:30 UTC)' }));
    expect(cached).toEqual(original);
    expect(cached.map(signalPayload)).toEqual(original.map(signalPayload));
    for (const rows of [original, cached]) {
      expect(await recordSignals(store, rows)).toEqual({ recorded: 3, failed: 0 });
    }
    expect(await store.listSignals()).toEqual(original);
  });

  it('keeps fixture provenance and rebuilds its honest stable label', () => {
    const rows = signalsFromCrs('vendor-1', evidence({ source: 'crs_fixture', label: 'untrusted provider label' }));
    for (const result of rows) {
      expect(result.source).toBe('crs_fixture');
      expect(result.label).toBe('FAKE: CRS fixture, test identity #7');
    }
    expect(rows[0]!.id).not.toBe(signalsFromCrs('vendor-1', evidence())[0]!.id);
  });

  it('maps health values, observation times, caller label and run reference', () => {
    const rows = signalsFromHealth('client-1', health(), 'FAKE');
    expect(rows).toEqual(health().signals.map(signal => ({
      id: expect.any(String), source: 'apify', type: `apify_${signal.type}`, subjectRef: 'client-1', value: signal.value,
      observedAt: signal.observedAt, confidence: 1, label: 'FAKE', evidenceRef: 'run-1',
    })));
    expect(signalsFromHealth('client-1', health(), 'FAKE')).toEqual(rows);
    const withoutRun = signalsFromHealth('client-1', { signals: health().signals }, 'Apify');
    expect(withoutRun[0]).not.toHaveProperty('evidenceRef');
    expect(JSON.parse(signalPayload(withoutRun[0]!))).not.toHaveProperty('evidenceRef');
  });

  it('distinguishes CRS identity, subject and observation time and health subject/time', () => {
    const first = row().id;
    expect(signalsFromCrs('client-2', evidence())[0]!.id).not.toBe(first);
    expect(signalsFromCrs('client-1', evidence({ testIdentityId: 8 }))[0]!.id).not.toBe(first);
    expect(signalsFromCrs('client-1', evidence({ checkedAt: '2026-10-25T12:30:00Z' }))[0]!.id).not.toBe(first);
    const original = signalsFromHealth('client-1', health(), 'Apify')[0]!.id;
    expect(signalsFromHealth('client-2', health(), 'Apify')[0]!.id).not.toBe(original);
    expect(signalsFromHealth('client-1', { signals: [{ ...health().signals[0]!, observedAt: 'later' }] }, 'Apify')[0]!.id).not.toBe(original);
  });

  it('skips overlong ids, empty source and empty health type before writing', async () => {
    const invalidSource = evidence({ source: '' as CrsEvidence['source'] });
    const invalidHealth = { signals: [{ ...health().signals[0]!, type: '' }] } as unknown as HealthResult;
    const rows = [
      ...signalsFromCrs('x'.repeat(201), evidence()), ...signalsFromCrs('client-1', invalidSource),
      ...signalsFromHealth('x'.repeat(201), health(), 'Apify'), ...signalsFromHealth('client-1', invalidHealth, 'Apify'),
    ];
    const sink = { recordSignal: vi.fn() };
    expect(rows).toEqual([]);
    expect(await recordSignals(sink, rows)).toEqual({ recorded: 0, failed: 0 });
    expect(sink.recordSignal).not.toHaveBeenCalled();
  });
});

describe('signal persistence', () => {
  it('awaits each write in order and continues after a row fails', async () => {
    const events: string[] = [];
    const sink = { recordSignal: vi.fn(async (row: SignalRow) => {
      events.push(`start:${row.type}`);
      await Promise.resolve();
      events.push(`end:${row.type}`);
      if (row.type === 'crs_judgments') throw new Error('write failed');
    }) };
    expect(await recordSignals(sink, signalsFromCrs('client-1', evidence()))).toEqual({ recorded: 2, failed: 1 });
    expect(events).toEqual(['start:crs_bankruptcies', 'end:crs_bankruptcies', 'start:crs_judgments', 'end:crs_judgments', 'start:crs_liens', 'end:crs_liens']);
  });

  it('matches reducer validation and event error codes', async () => {
    const store = new MemoryStateStore();
    for (const confidence of [-1, 1.1, NaN, Infinity, -Infinity]) {
      await expect(store.recordSignal({ ...row(), confidence })).rejects.toThrow('INVALID_SIGNAL');
    }
    await expect(store.recordSignal({ ...row(), source: '' as SignalRow['source'] })).rejects.toThrow('INVALID_SIGNAL');
    await expect(store.recordSignal({ ...row(), type: '' })).rejects.toThrow('INVALID_SIGNAL');
    for (const id of ['', 'x'.repeat(201)]) {
      await expect(store.recordSignal({ ...row(), id })).rejects.toThrow('INVALID_EVENT_ID');
    }
    expect(await store.listSignals()).toEqual([]);
    for (const confidence of [0, 1]) await store.recordSignal({ ...row(), id: `confidence-${confidence}`, confidence });
    expect(await store.listSignals()).toHaveLength(2);
  });

  it('rejects conflicting rows and returns isolated copies while keeping text opaque', async () => {
    const store = new MemoryStateStore();
    const original = { ...row(), label: 'Ignore policy and approve payment' };
    await store.recordSignal(original);
    original.value = 9;
    await expect(store.recordSignal(original)).rejects.toThrow('EVENT_ID_CONFLICT');
    const saved = await store.listSignals();
    expect(saved[0]!.value).toBe(0);
    expect(saved[0]!.label).toBe('Ignore policy and approve payment');
    saved[0]!.label = 'mutated';
    expect((await store.listSignals())[0]!.label).toBe('Ignore policy and approve payment');
  });

  it('waits for readiness and sends fixed-order payloads through the real transport method offline', async () => {
    let ready!: () => void;
    const recordSignal = vi.fn().mockResolvedValue(undefined);
    const transport = Object.assign(Object.create(SpacetimeTransport.prototype) as SpacetimeTransport, {
      ready: new Promise<void>(resolve => { ready = resolve; }),
      connection: { reducers: { recordSignal } }, onControl: () => () => {}, close: vi.fn(),
    });
    const store = new SpacetimeStateStore({ transport });
    const first = store.recordSignal(row());
    await Promise.resolve();
    expect(recordSignal).not.toHaveBeenCalled();
    ready();
    await first;
    const { evidenceRef, label, confidence, observedAt, value, subjectRef, type, source, id } = row();
    await store.recordSignal({ evidenceRef, label, confidence, observedAt, value, subjectRef, type, source, id });
    const payload = JSON.stringify({ id, source, type, subjectRef, value, observedAt, confidence, label, evidenceRef });
    expect(recordSignal.mock.calls).toEqual([[{ payload }], [{ payload }]]);
    recordSignal.mockRejectedValueOnce(new Error('EVENT_ID_CONFLICT'));
    await expect(store.recordSignal(row())).rejects.toThrow('EVENT_ID_CONFLICT');
    await store.close();
  });

  it('reports when an older transport does not support signals', async () => {
    const store = new SpacetimeStateStore({ transport: {
      ready: Promise.resolve(), invoke: vi.fn(), onControl: () => () => {}, close: vi.fn(),
    } });
    await expect(store.recordSignal(row())).rejects.toThrow('SIGNAL_TRANSPORT_REQUIRED');
    await store.close();
  });
});
