import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AgentHandoffPublic } from '@backroom/orchestrator/spacetime-client/types';
import { HANDOFF_AGENTS, HANDOFF_ROLES, FLOOR_AGENTS, compareHandoffs, handoffFlag, handoffFromRow, handoffGroups, handoffLine, handoffRoute, handoffSpot, needsHandoffHuman, upsertHandoffs } from './handoffs';
import { insideAny, officeColliders } from './play';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { projectOfficeRows } from './spacetime';

const raw = { handoffId: 'h', sequence: 1n, caseDisplayId: 'INV-2', fromAgentId: 'intake-agent', toAgentId: 'vendor-agent',
  fromRole: 'intake', toRole: 'vendor', fromVoiceRole: 'intake_sorter', toVoiceRole: 'vendor_verifier', status: 'offered', correction: false,
  createdAt: 1000, reason: 'Verify remit-to', summary: 'Documents attached', line: 'Please verify the documents.' };
const row = (extra = {}) => handoffFromRow({ ...raw, ...extra })!;

describe('handoff public contract', () => {
  it('matches the runtime ROLES list without importing server code', () => {
    const source = readFileSync(new URL('../../../orchestrator/src/agents/contracts.ts', import.meta.url), 'utf8');
    const roles = source.match(/export const ROLES\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1]?.match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
    expect(roles).toEqual(HANDOFF_ROLES);
    expect(FLOOR_AGENTS.slice().sort()).toEqual([...HANDOFF_ROLES].sort());
  });
  it('parses camel and snake case fields and bigint sequence/timestamps', () => {
    expect(handoffFromRow(raw)).toEqual(raw);
    const snake = Object.fromEntries(Object.entries({ ...raw, acceptedAt: 2000n, completedAt: 3000n, decisionRef: 'd', errorCode: 'e' })
      .map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
    expect(handoffFromRow(snake)).toEqual({ ...raw, acceptedAt: 2000, completedAt: 3000, decisionRef: 'd', errorCode: 'e' });
  });
  it.each([null, [], 42, {}, { ...raw, handoffId: '' }, { ...raw, fromRole: 'intake_sorter' }, { ...raw, fromRole: 'human' }, { ...raw, toRole: 'Dana' },
    { ...raw, status: 'pending' }, { ...raw, status: 'failed' }, { ...raw, status: 'awaiting_passkey' },
    { ...raw, sequence: -1n }, { ...raw, sequence: 1.1 }, { ...raw, sequence: NaN }, { ...raw, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...raw, sequence: 18_446_744_073_709_551_616n }, { ...raw, sequence: '123' }, { ...raw, fromRole: 'intake'.padEnd(300) }])('rejects malformed rows (case %#)', value => {
    expect(handoffFromRow(value)).toBeNull();
  });
  it('accepts a code-published escalation to the human desk as the receiver, never as the sender', () => {
    expect(handoffFromRow({ ...raw, toRole: 'human', toAgentId: 'human:Dana' })).toMatchObject({ toRole: 'human', toAgentId: 'human:Dana' });
  });
  it('caps strings, ignores malformed optional fields and tolerates missing timestamps', () => {
    expect(row({ handoffId: 'x'.repeat(200), summary: 's'.repeat(200), reason: 'r'.repeat(2000), line: 'l'.repeat(400),
      decisionRef: 'd'.repeat(400), errorCode: 'e'.repeat(400), createdAt: undefined, acceptedAt: Infinity, completedAt: {}, correction: 'true' }))
      .toMatchObject({ handoffId: 'x'.repeat(200), summary: 's'.repeat(160), reason: 'r'.repeat(1000), line: 'l'.repeat(400),
        decisionRef: 'd'.repeat(256), errorCode: 'e'.repeat(128), createdAt: 0, correction: false });
    expect(row({ acceptedAt: NaN }).acceptedAt).toBeUndefined();
  });
  it('keeps distinct handoff primary keys for a 200-character case id in u64 order', () => {
    const activationId = `${'c'.repeat(200)}:a1`;
    const first = row({ handoffId: `${activationId}:h1`, sequence: 9_007_199_254_740_992n });
    const second = row({ handoffId: `${activationId}:h2`, sequence: 9_007_199_254_740_993n });
    const updated = { ...first, status: 'accepted' as const };
    expect(upsertHandoffs([second, first], [updated])).toEqual([updated, second]);
    expect(first.handoffId).toBe(`${activationId}:h1`);
    expect(second.handoffId).toBe(`${activationId}:h2`);
  });
  it('preserves a trailing masked token after 77 emoji within the summary limit', () => {
    const summary = `${'😀'.repeat(77)} ••6819`;
    expect(row({ summary }).summary).toBe(summary);
    expect(row({ summary: '😀'.repeat(161) }).summary).toBe('😀'.repeat(160));
  });
  it.each(['••6819', 'GB29 NWBK ••6819', '[email]'])('keeps a masked token whole at the summary boundary: %s', token => {
    const prefix = 's'.repeat(158) + ' ';
    expect(row({ summary: prefix + token + ' trailing text' }).summary).toBe(prefix + token);
  });
  it('orders u64 sequences without rounding and groups by case display id', () => {
    const a = row({ handoffId: 'z', sequence: 9_007_199_254_740_992n }), b = row({ handoffId: 'a', sequence: 9_007_199_254_740_993n });
    const c = row({ handoffId: 'c', sequence: 2, caseDisplayId: 'INV-3' });
    expect([b, a, c].sort(compareHandoffs)).toEqual([c, a, b]);
    expect(handoffGroups([b, c, a])).toEqual([{ caseDisplayId: 'INV-3', rows: [c] }, { caseDisplayId: 'INV-2', rows: [a, b] }]);
  });
  it('projects the public rows through the office adapter without affecting other state', () => {
    const publicRow: AgentHandoffPublic = { ...raw, acceptedAt: undefined, completedAt: undefined, decisionRef: undefined, errorCode: undefined };
    const snapshot = projectOfficeRows({ agents: [], rooms: [], seats: [], badges: [], escalations: [], audit: [], control: [], handoffs: [publicRow] });
    expect(snapshot.handoffs).toEqual([raw]);
    expect(snapshot.agents).toEqual([]);
  });
  it.each(['offered', 'accepted', 'completed', 'rejected'])('never infers a human from %s', status => {
    expect(needsHandoffHuman(row({ status, summary: 'passkey required', line: 'human approval' }))).toBe(false);
  });
  it.each([{ reason: 'Human approval required' }, { reason: 'Escalated to Dana' }, { decisionRef: 'passkey:42' }])('recognizes explicit human approval evidence (%j)', evidence => {
    expect(needsHandoffHuman(row(evidence))).toBe(true);
  });
  it.each(['No human approval required', 'Without a passkey', 'Not escalated'])('does not summon Dana for negated evidence: %s', reason => {
    expect(needsHandoffHuman(row({ reason }))).toBe(false);
    expect(needsHandoffHuman(row({ reason, decisionRef: 'passkey:42' }))).toBe(true);
  });
  it('shows the case, reason, summary, correction and rejection error', () => {
    expect(handoffLine(row({ status: 'rejected', correction: true, errorCode: 'MISMATCH' })))
      .toBe('Correction · Intake → Vendor verifier · INV-2: Verify remit-to · Documents attached · rejected · MISMATCH');
    expect(handoffLine(row({ errorCode: 'MISMATCH' }))).not.toContain('MISMATCH');
  });
});

describe('handoff floor and flags', () => {
  it('keeps mapped stations, handoff spots and aisle routes clear of furniture', () => {
    const colliders = officeColliders(Object.keys(OFFICE_ANCHORS) as AnchorId[]);
    for (const id of [...FLOOR_AGENTS, 'human' as const]) {
      expect(insideAny(HANDOFF_AGENTS[id].station, colliders, .2), id).toBe(false);
      expect(insideAny(handoffSpot(id), colliders, .2), id).toBe(false);
    }
    expect(handoffRoute('intake', 'payables').some(([, z]) => z === .6)).toBe(true);
  });
  it('reads the opt-in mock and bounded speed', () => {
    expect(handoffFlag('')).toEqual({ mock: false, speed: 1 });
    expect(handoffFlag('?handoffs=mock&handoffSpeed=30')).toEqual({ mock: true, speed: 8 });
    expect(handoffFlag('?handoffs=mock&handoffSpeed=nope')).toEqual({ mock: true, speed: 1 });
  });
});
