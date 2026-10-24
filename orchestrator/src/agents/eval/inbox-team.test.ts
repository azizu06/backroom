import { afterEach, expect, it, vi } from 'vitest';
import { runInboxTeam } from './inbox-team';

afterEach(() => vi.unstubAllGlobals());

it('runs the real inbox roles through createInboxAgents and does not pay or replace the seat decision', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runInboxTeam();
  expect(run.checks, JSON.stringify({ reason: run.reason, roles: run.roles, payment: run.payment, assessment: run.assessment, optOut: run.optOut, caseStatus: run.caseStatus })).toEqual({
    fiveRoles: true,
    syntheticCost: true,
    idempotentCase: true,
    officeHandoffs: true,
    ledgerSpend: true,
    judgeMetadata: true,
    allowAssessment: true,
    holdOnly: true,
    decisionStands: true,
    flagMatrix: true,
    agentsOff: true,
    auditChain: true,
    noNetwork: true,
  });
  expect(run.match).toBe(true);
  expect(run.caseStatus).toBe('done');
  expect(run.roles).toEqual(['intake', 'extractor', 'vendor', 'payables', 'auditor']);
  expect(run.syntheticCostUsd).toBeCloseTo(0.002, 6);
  expect(run.handoffs).toHaveLength(4);
  expect(run.handoffs).toEqual(expect.arrayContaining([
    expect.objectContaining({ fromRole: 'intake', toRole: 'extractor', status: 'completed' }),
    expect.objectContaining({ fromRole: 'payables', toRole: 'auditor', status: 'completed' }),
  ]));
  expect(run.assessment).toBe('ALLOW');
  expect(run.payment).toMatchObject({ status: 'held', verdict: 'ESCALATE', ruleIds: ['INVALID_INPUT'] });
  expect(run.seatDecision).toBe('ALLOW');
  expect(run.providerRequests).toBe(0);
  expect(run.optOut).toMatchObject({ narrated: false, hostCreated: false, httpStatus: 200, agentAudits: 0, recordedDecision: expect.any(String) });
  expect(run.optOut.responseRules).toContain('LOOKALIKE_DOMAIN');
  expect(run.optOut.recordedRules).toEqual(run.optOut.responseRules);
});
