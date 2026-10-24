import { expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { PayablesSeat } from './index';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource } from './northfield';

async function seatFor() {
  const repository = await createNorthfieldRepository();
  const state = new MemoryStateStore();
  const pay = vi.fn(async () => ({ id: 'mock-receipt', status: 'completed' as const }));
  const seat = new PayablesSeat({ repository, state, paymentRail: 'nessie', nessie: { payInvoice: pay },
    controller: { request: async () => 'test-escalation' } });
  return { repository, state, pay, seat };
}
const fenced = async (state: MemoryStateStore) => (await state.listAudit()).filter(row => row.action === 'payment_fenced');

it('a fence that fails before the reservation writes no reservation and makes no provider request', async () => {
  const { repository, state, pay, seat } = await seatFor();
  await expect(seat.process(northfieldInvoice('4401'), northfieldSource('4401'),
    { fence: () => { throw new Error('AGENT_LEASE_STALE'); } })).rejects.toThrow('AGENT_LEASE_STALE');
  expect(pay).not.toHaveBeenCalled();
  expect((await repository.getInvoice('papertrail', '4401'))?.paymentAttempted ?? false).toBe(false);
  expect((await fenced(state)).map(row => row.inputs)).toEqual([expect.objectContaining({ stage: 'reservation', error: 'AGENT_LEASE_STALE' })]);
});

it('a fence that fails between reservation and provider releases the reservation, so the current owner can still pay once', async () => {
  const { repository, state, pay, seat } = await seatFor();
  let calls = 0;
  await expect(seat.process(northfieldInvoice('4401'), northfieldSource('4401'),
    { fence: () => { if (++calls === 2) throw new Error('AGENT_LEASE_EXPIRED'); } })).rejects.toThrow('AGENT_LEASE_EXPIRED');
  expect(calls).toBe(2);
  expect(pay).not.toHaveBeenCalled();
  expect((await repository.getInvoice('papertrail', '4401'))?.paymentAttempted).toBe(false);
  expect((await fenced(state)).map(row => row.inputs)).toEqual([expect.objectContaining({ stage: 'provider' })]);

  const result = await seat.process(northfieldInvoice('4401'), northfieldSource('4401'), { fence: () => undefined });
  expect(result.status).toBe('paid');
  expect(pay).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'ap:papertrail:4401' }));
});

it('an uncertain provider response after a passing fence stays held and is never released', async () => {
  const { repository, seat } = await seatFor();
  const uncertain = new PayablesSeat({ repository, state: new MemoryStateStore(), paymentRail: 'nessie',
    nessie: { payInvoice: async () => { throw new Error('TIMEOUT'); } }, controller: { request: async () => 'test-escalation' } });
  const result = await uncertain.process(northfieldInvoice('4401'), northfieldSource('4401'), { fence: () => undefined });
  expect(result.status).toBe('held');
  expect((await repository.getInvoice('papertrail', '4401'))?.paymentAttempted).toBe(true);
  // A later owner replays the held record instead of sending a second request.
  expect((await seat.process(northfieldInvoice('4401'), northfieldSource('4401'), { fence: () => undefined })).status).toBe('held');
});

it('records whether the effect fence applied on every pay_invoice decision', async () => {
  const { state, seat } = await seatFor();
  await seat.process(northfieldInvoice('4401'), northfieldSource('4401'));
  const row = (await state.listAudit()).find(entry => entry.action === 'pay_invoice');
  expect(row?.inputs).toMatchObject({ fence: 'not_applicable' });
});
