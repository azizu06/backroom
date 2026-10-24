import { expect, it } from 'vitest';
import { approvalWindowMs, DEFAULT_APPROVAL_WINDOW_MS, MAX_APPROVAL_WINDOW_MS } from './window';

it('uses five minutes unless APPROVAL_WINDOW_MS is a bounded integer', () => {
  expect(approvalWindowMs({})).toBe(DEFAULT_APPROVAL_WINDOW_MS);
  expect(approvalWindowMs({ APPROVAL_WINDOW_MS: '' })).toBe(DEFAULT_APPROVAL_WINDOW_MS);
  expect(approvalWindowMs({ APPROVAL_WINDOW_MS: 'nope' })).toBe(DEFAULT_APPROVAL_WINDOW_MS);
  expect(approvalWindowMs({ APPROVAL_WINDOW_MS: '999' })).toBe(DEFAULT_APPROVAL_WINDOW_MS);
  expect(approvalWindowMs({ APPROVAL_WINDOW_MS: '120000' })).toBe(120_000);
  expect(approvalWindowMs({ APPROVAL_WINDOW_MS: '999999999' })).toBe(MAX_APPROVAL_WINDOW_MS);
});
