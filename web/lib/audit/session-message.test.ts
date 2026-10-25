import { describe, expect, it } from 'vitest';
import { auditUnlockMessage, CODE_REJECTED, ORIGIN_REJECTED } from './session-message';

describe('audit unlock copy', () => {
  it('keeps a refused page distinct from a refused operator code', () => {
    expect(auditUnlockMessage('Origin rejected.')).toBe(ORIGIN_REJECTED);
    expect(auditUnlockMessage('Operator code rejected.')).toBe(CODE_REJECTED);
    expect(ORIGIN_REJECTED).not.toBe(CODE_REJECTED);
    expect(auditUnlockMessage('Backroom is not responding right now (HTTP 502). Try again in a moment.')).toContain('HTTP 502');
  });
});
