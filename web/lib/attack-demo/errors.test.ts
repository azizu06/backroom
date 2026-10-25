import { describe, expect, it } from 'vitest';
import { attackErrorMessage } from './errors';

describe('attack error wording', () => {
  it('explains offline, timeout, validation, configuration and rate limiting', () => {
    expect(attackErrorMessage('ATTACK_UNREACHABLE', 502)).toContain('host Mac');
    expect(attackErrorMessage(undefined, 502)).toContain('host Mac');
    expect(attackErrorMessage('ATTACK_TIMEOUT')).toContain('timed out');
    expect(attackErrorMessage(undefined, 504)).toContain('timed out');
    expect(attackErrorMessage('INVALID_ATTACK')).toContain('2,000 characters');
    expect(attackErrorMessage('ATTACK_NOT_CONFIGURED')).toContain('not configured');
    expect(attackErrorMessage('ATTACK_RATE_LIMITED')).toContain('Wait a minute');
    expect(attackErrorMessage(undefined, 429)).toContain('single live attempt');
  });
  it('never echoes an unknown server error', () => {
    expect(attackErrorMessage('<script>secret</script>', 500)).toBe('The attack service could not complete the request. Try again in a moment.');
    expect(attackErrorMessage('__proto__', 500)).toBe('The attack service could not complete the request. Try again in a moment.');
    expect(attackErrorMessage('ATTACK_BAD_RESPONSE', 502)).toContain('unreadable result');
    expect(attackErrorMessage('NETWORK_ERROR')).toContain('Check your connection');
  });
  it('maps upstream statuses to judge friendly wording and keeps proxy errors distinct', () => {
    expect(attackErrorMessage('ATTACK_REJECTED', 400)).toMatch(/invalid request/i);
    expect(attackErrorMessage('ATTACK_REJECTED', 401)).toMatch(/not configured/i);
    expect(attackErrorMessage('ATTACK_REJECTED', 403)).toBe("Live mode isn't enabled on this server");
    expect(attackErrorMessage('ATTACK_REJECTED', 404)).toContain('could not complete');
    expect(attackErrorMessage('ATTACK_REJECTED', 405)).toContain('could not complete');
    expect(attackErrorMessage('ATTACK_REJECTED', 409)).toContain('LLM OFF');
    expect(attackErrorMessage('ATTACK_REJECTED', 413)).toMatch(/too long/i);
    expect(attackErrorMessage('ATTACK_REJECTED', 429)).toContain('single live attempt');
    expect(attackErrorMessage('ATTACK_REJECTED', 502)).toContain('host Mac');
    expect(attackErrorMessage('ATTACK_RATE_LIMITED', 429)).toContain('Wait a minute');
    expect(attackErrorMessage('ORIGIN_REJECTED', 403)).toContain('configured deployment');
  });
});
