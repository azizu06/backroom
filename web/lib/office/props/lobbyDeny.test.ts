import { describe, expect, it } from 'vitest';
import { type OfficeAudit } from '../state';
import { latestDenyRule } from './lobbyDeny';

const row = (decision: OfficeAudit['decision'], ruleIds: readonly string[] = []): OfficeAudit =>
  ({ id: 'audit', agentId: 'a', seatId: 'collections', action: 'request_room_entry', decision, ruleIds, summary: decision });

describe('latestDenyRule', () => {
  it('has no stamp without a DENY', () => {
    expect(latestDenyRule({ audit: [] })).toBeNull();
    expect(latestDenyRule({ audit: [row('ALLOW'), row('ESCALATE'), row('RECORDED')] })).toBeNull();
  });

  it('uses the latest DENY and its first rule, even after later allowed rows', () => {
    const audit = [row('DENY', ['OLD']), row('DENY', ['NOT_IN_BADGE', 'SECOND']), row('ALLOW', ['OTHER'])];
    expect(latestDenyRule({ audit })).toBe('NOT_IN_BADGE');
    expect(audit[1]!.ruleIds).toEqual(['NOT_IN_BADGE', 'SECOND']);
  });

  it('keeps a stamp for a DENY without rules instead of reviving an older rule', () => {
    expect(latestDenyRule({ audit: [row('DENY', ['OLD']), row('DENY')] })).toBe('DENIED');
  });
});
