import { expect, it } from 'vitest';
import { createLlmControlHandler, getStateStore, MemoryStateStore } from '@backroom/orchestrator';
import { join } from 'node:path';
import { operatorRoot } from '../operator/control';
import { approvalState, controllerCredentialFile, installApprovalStateStore } from './runtime';

it('persists the controller credential under .demo only on the demo host or when configured', () => {
  expect(controllerCredentialFile({})).toBeUndefined();
  expect(controllerCredentialFile({ BACKROOM_DEMO: '1' })).toBe(join(operatorRoot(), '.demo/controller-credential.json'));
  expect(controllerCredentialFile({ CONTROLLER_CREDENTIAL_FILE: '/tmp/dana.json' })).toBe('/tmp/dana.json');
  expect(controllerCredentialFile({ BACKROOM_DEMO: '1', CONTROLLER_CREDENTIAL_FILE: '.demo/other.json' }))
    .toBe(join(operatorRoot(), '.demo/other.json'));
});

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
