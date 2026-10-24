import { expect, it, vi } from 'vitest';
import { MemoryStateStore, routeInboxItem } from './index';

it.each([true, false])('RT-251 escalates raw judge mail and persists its source with models enabled=%s', async enabled => {
  const store = new MemoryStateStore();
  await store.setLlmEnabled(enabled);
  const network = vi.fn();
  const result = await routeInboxItem({ id: 'RT-251', kind: 'email', source: 'judge', subject: 'Unrecognized request' }, store, { fetch: network });
  expect(result).toMatchObject({ decision: 'ESCALATE', source: 'code' });
  const entry = (await store.listAudit()).find(row => row.action === 'route_inbox_item');
  expect(entry).toMatchObject({ decision: 'ESCALATE', inputs: { scenario_source: 'judge' } });
  expect(await store.getEscalation('judge-inbox:RT-251')).toMatchObject({ status: 'pending', evidenceRefs: ['RT-251'] });
  expect(network).not.toHaveBeenCalled();
});

it('escalates unsupported judge kinds received at runtime instead of assuming a recognized queue', async () => {
  const store = new MemoryStateStore();
  const item = JSON.parse('{"id":"RT-251","source":"judge","kind":"unsupported"}');
  expect(await routeInboxItem(item, store)).toMatchObject({ decision: 'ESCALATE' });
});
