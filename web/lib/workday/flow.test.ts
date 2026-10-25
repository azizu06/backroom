import { expect, it } from 'vitest';
import { flowCaption } from './flow';
import { mockCycleRows } from '../office/handoff-mock';
const row = { ...mockCycleRows(0, 1000, 1000)[0]!, caseDisplayId: 'INV-4481', fromRole: 'extractor' as const,
  toRole: 'vendor' as const, status: 'accepted' as const, reason: 'SECRET bankAccountId bank-master:harbor amount 85000 cents USD', line: 'SECRET', summary: 'SECRET' };
it('keeps live handoff captions short, human and free of payload details', () => {
  expect(flowCaption(row)).toBe('Extractor → Vendor · INV-4481 · verifying vendor bank details');
  expect(flowCaption({ ...row, toRole: 'human' })).toContain('held for Dana’s review');
  expect(flowCaption({ ...row, status: 'completed' })).toContain('finished the handoff');
  expect(flowCaption({ ...row, status: 'rejected' })).toContain('held for review');
  expect(flowCaption({ ...row, correction: true })).toContain('checking a correction');
  expect(flowCaption({ ...row, caseDisplayId: 'bank-master:secret' })).toContain('this case');
  expect(flowCaption(row)).not.toMatch(/SECRET|bankAccountId|85000|cents/);
  expect(flowCaption(row).length).toBeLessThan(100);
});
