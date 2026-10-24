import { describe, expect, it } from 'vitest';
import { attackErrorMessage } from './errors';

describe('attack error wording', () => {
  it('explains offline, timeout, validation, configuration and rate limiting', () => {
    expect(attackErrorMessage('ATTACK_UNREACHABLE', 502)).toBe('The attack demo service is offline');
    expect(attackErrorMessage(undefined, 502)).toBe('The attack demo service is offline');
    expect(attackErrorMessage('ATTACK_TIMEOUT')).toContain('timed out');
    expect(attackErrorMessage(undefined, 504)).toContain('timed out');
    expect(attackErrorMessage('INVALID_ATTACK')).toContain('2,000 characters');
    expect(attackErrorMessage('ATTACK_NOT_CONFIGURED')).toContain('not configured');
    expect(attackErrorMessage('ATTACK_RATE_LIMITED')).toContain('Wait a minute');
    expect(attackErrorMessage(undefined, 429)).toContain('Wait a minute');
  });
  it('never echoes an unknown server error', () => {
    expect(attackErrorMessage('<script>secret</script>', 500)).toBe('The attack demo could not complete the request. Try again in a moment.');
    expect(attackErrorMessage('__proto__', 500)).toBe('The attack demo could not complete the request. Try again in a moment.');
    expect(attackErrorMessage('ATTACK_BAD_RESPONSE', 502)).toContain('unreadable result');
    expect(attackErrorMessage('NETWORK_ERROR')).toContain('Check your connection');
  });
});
