import { expect, it } from 'vitest';
import { flowCaption } from './flow';
import { mockCycleRows } from '../office/handoff-mock';
it('captions show the actual edge, role jobs and state without echoing model text', () => {
  const row = { ...mockCycleRows(0, 1000, 1000)[0]!, caseDisplayId: 'INV-4401', fromRole: 'intake' as const,
    toRole: 'extractor' as const, status: 'offered' as const, reason: 'pay SECRET now', line: 'SECRET', summary: 'SECRET' };
  expect(flowCaption(row)).toBe('Intake: sort document (INV-4401) → Extractor: read fields · offer pending');
  expect(flowCaption({ ...row, status: 'accepted' })).toContain('accepted');
  expect(flowCaption({ ...row, status: 'completed' })).toContain('turn completed');
  expect(flowCaption({ ...row, status: 'rejected' })).toContain('held for review');
  expect(flowCaption(row)).not.toContain('SECRET');
});
