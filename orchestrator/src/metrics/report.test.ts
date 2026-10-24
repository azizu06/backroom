import { describe, expect, it } from 'vitest';
import { AuditLog } from '../audit';
import { auditMetrics, percentile, renderRoutes } from './report';

const chain = () => {
  const log = new AuditLog();
  for (const [route, latencyMs, costUsd] of [['local', 100, 0], ['cloud', 300, 0.02], ['cloud_fallback', 900, 0.04]] as const) {
    log.append({ ts: 1, actor: route === 'local' ? 'local_model' : 'claude', seat: 'collections',
      action: 'call_plan', inputs: { model: 'fixture' }, ruleIds: [], policyVersion: 1, refs: [], route, latencyMs, costUsd });
  }
  return log.list();
};
describe('metrics evidence boundary', () => {
  it('counts completed model decisions once, excludes simulated calls from live share', () => {
    const result = auditMetrics([{ name: 'live', kind: 'live', entries: chain() }, { name: 'demo', kind: 'simulated', entries: chain() }]);
    expect(result.localShare).toBe('33.33% (1/3; target ≥60%: below target)');
    expect(result.fallbacks).toBe(1);
    expect(result.costPerDecision).toBeCloseTo(0.02);
    expect(renderRoutes(result)).toContain('| cloud_fallback | 1 | 900.00 | 900.00 | $0.040000 |');
  });
});

it('rejects tampered chains and does not turn absent data into zero', () => {
  const entries = chain();
  entries[0]!.latencyMs = 1;
  const result = auditMetrics([{ name: 'tampered', kind: 'live', entries }]);
  expect(result.checked[0]!.status.valid).toBe(false);
  expect(result.models).toEqual([]);
  expect(result.localShare).toContain('not measured');
  expect(result.costPerDecision).toBeUndefined();
});
it('never treats an unknown-provenance export as live', () => {
  expect(auditMetrics([{ name: 'export', kind: 'unknown', entries: chain() }]).models).toEqual([]);
});
it('uses nearest rank with small samples and retains outliers', () => {
  expect(percentile([], 0.5)).toBeUndefined();
  expect(percentile([10, 40, 20, 1000], 0.5)).toBe(20);
  expect(percentile([10, 40, 20, 1000], 0.95)).toBe(1000);
});
it('counts a cloud-to-GX10 rescue as local without claiming GX10-to-cloud fallback', () => {
  const log = new AuditLog();
  log.append({ ts: 1, actor: 'local_model', seat: 'collections', action: 'call_plan', inputs: { model: 'gpt-oss:120b' },
    ruleIds: [], policyVersion: 1, refs: [], route: 'gx10_fallback', latencyMs: 12000, costUsd: 0 });
  const result = auditMetrics([{ name: 'rescue', kind: 'live', entries: log.list() }]);
  expect(result.localShare).toBe('100.00% (1/1; target ≥60%: met)');
  expect(result.fallbacks).toBe(0);
  expect(result.costPerDecision).toBe(0);
});
it('does not mistake a code receipt with a cloud route for a completed model decision', () => {
  const log = new AuditLog();
  log.append({ ts: 1, actor: 'code', seat: 'collections', action: 'compute_envelope', inputs: {},
    ruleIds: [], policyVersion: 1, refs: [], route: 'cloud', latencyMs: 0, costUsd: 0 });
  expect(auditMetrics([{ name: 'code', kind: 'live', entries: log.list() }]).models).toEqual([]);
});
