import { describe, expect, it } from 'vitest';
import { INBOX_SHEET_LIMIT, inboxSheets } from './inboxStack';

describe('inboxSheets', () => {
  it('uses whole sheets and caps the visual stack without changing the actual count', () => {
    for (const [count, sheets] of [[0, 0], [1, 1], [3.9, 3], [12, 12], [99, 12], [-5, 0]]) {
      expect(inboxSheets(count!)).toBe(sheets);
    }
    expect(inboxSheets(Infinity)).toBe(INBOX_SHEET_LIMIT);
    expect(inboxSheets(-Infinity)).toBe(0);
    expect(inboxSheets(NaN)).toBe(0);
  });
});
