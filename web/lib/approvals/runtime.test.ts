import { expect, it } from 'vitest';
import { createLlmControlHandler, getStateStore, MemoryStateStore } from '@backroom/orchestrator';
import { approvalState, installApprovalStateStore } from './runtime';

it('shares the installed StateStore and model OFF properties with controller approvals', async () => {
  const state = new MemoryStateStore();
  await installApprovalStateStore(state);
  const control = createLlmControlHandler({ secret: () => 'local-test' });
  await control(new Request('http://localhost/api/llm', { method: 'POST',
    headers: { authorization: 'Bearer local-test', 'Content-Type': 'application/json' }, body: JSON.stringify({ llmEnabled: false }) }));
  expect(getStateStore()).toBe(state);
  expect(approvalState.llmEnabled).toBe(false);
  expect(approvalState.llmSignal.aborted).toBe(true);
  await approvalState.registerAgent('controller-test', 'collections', 0);
  expect((await state.getAgent('controller-test'))?.id).toBe('controller-test');
});
