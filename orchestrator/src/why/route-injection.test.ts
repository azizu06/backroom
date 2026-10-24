import { expect, it, vi } from 'vitest';
import { askWhy, type WhyAuditEntry } from './index';
import { createRouter } from '../router';
import { MemoryStateStore } from '../store';

it('accepts an operator-supplied router and still validates citations', async () => {
  const entries: WhyAuditEntry[] = [{ id: 'audit_1', actor: 'code', seat: 'collections', action: 'propose_plan', outcome: 'denied', policyVersion: 1,
    ruleIds: ['FEES_NON_WAIVABLE'], evidenceRefs: ['1042'], inputs: { invoiceId: '1042' } }];
  const network = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: { answer: 'Fee waiver denied. [entry:audit_1]', citations: ['audit_1'] }, confidence: 1 }) } }], usage: { cost: 0 } }));
  const modelRoute = createRouter({ stateStore: new MemoryStateStore(), cloudApiKey: 'mock', fetch: network }).route;
  const answer = await askWhy('Why denied for 1042?', entries, { stateStore: new MemoryStateStore(), fetch: async () => { throw new Error('NETWORK_FORBIDDEN'); }, modelRoute });
  expect(answer).toMatchObject({ source: 'model', citations: ['audit_1'] });
  expect(network).toHaveBeenCalledTimes(1);
});

it('makes the retry specify inline citation syntax after a citation-array-only answer', async () => {
  const entries: WhyAuditEntry[] = [{ id: 'audit_1', actor: 'code', seat: 'collections', action: 'propose_plan', outcome: 'denied', policyVersion: 1,
    ruleIds: ['FEES_NON_WAIVABLE'], evidenceRefs: ['1042'], inputs: { invoiceId: '1042' } }];
  const inputs: unknown[] = [];
  const state = new MemoryStateStore();
  const network = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: {
    answer: inputs.length === 1 ? 'Fee waiver denied.' : 'Fee waiver denied. [entry:audit_1]', citations: ['audit_1'],
  }, confidence: 1 }) } }], usage: { cost: 0 } }));
  const router = createRouter({ stateStore: state, cloudApiKey: 'mock', fetch: network });
  const answer = await askWhy('Why denied for 1042?', entries, { stateStore: state, modelRoute: (task, input, schema) => {
    inputs.push(input); return router.route(task, input, schema);
  } });
  expect(answer.source).toBe('model');
  expect(inputs[1]).toMatchObject({ correction: expect.stringContaining('[entry:ID]') });
});
