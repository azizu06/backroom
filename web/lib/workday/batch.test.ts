import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { MemoryUsageLedger } from '@backroom/orchestrator/agents';
import { createWorkdayBatch } from './batch';

function setup() {
  const control = new MemoryStateStore(), ledger = new MemoryUsageLedger();
  const submit = vi.fn(async (_id: string) => {});
  const batch = createWorkdayBatch({ control, ledger, enabled: () => true, submit, drain: async () => {}, wait: async () => {} });
  return { control, ledger, submit, batch };
}
describe('Start the workday batch', () => {
  it('accepts one batch per company reset, including concurrent and completed repeats', async () => {
    const { batch, submit } = setup();
    const starts = await Promise.all([batch.start(), batch.start()]);
    expect(starts.map(row => row.started)).toEqual([true, false]);
    await batch.drain();
    expect(submit.mock.calls.map(([id]) => id)).toEqual(['4401', '4481', '4482', 'bc-lookalike']);
    expect(await batch.start()).toMatchObject({ started: false, status: 'done', message: expect.stringContaining('already') });
    expect(submit).toHaveBeenCalledTimes(4);
    const fresh = setup();
    expect(await fresh.batch.start()).toMatchObject({ started: true });
    await fresh.batch.drain();
  });
  it('refuses near the shared stop, counting reservations, and refuses OFF without submissions', async () => {
    const { batch, ledger, submit, control } = setup();
    const reservation = await ledger.reserve('aziz', 38.01, 'demo');
    expect(await batch.start()).toMatchObject({ started: false, status: 'ready', message: expect.stringContaining('near') });
    expect(submit).not.toHaveBeenCalled();
    await ledger.release(reservation);
    await control.setLlmEnabled(false);
    expect(await batch.start()).toMatchObject({ started: false, message: expect.stringContaining('OFF') });
    expect(submit).not.toHaveBeenCalled();
  });
  it('stops remaining submissions when OFF is pressed mid-batch', async () => {
    const control = new MemoryStateStore(), ledger = new MemoryUsageLedger();
    const submit = vi.fn(async () => { await control.setLlmEnabled(false); });
    const batch = createWorkdayBatch({ control, ledger, enabled: () => true, submit, drain: async () => {}, wait: async () => {} });
    await batch.start(); await batch.drain();
    expect(batch.view()).toMatchObject({ status: 'stopped', message: expect.stringContaining('OFF') });
    expect(submit).toHaveBeenCalledOnce();
  });
});
