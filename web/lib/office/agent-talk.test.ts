import { describe, expect, it } from 'vitest';
import { EMPTY_DESK, NOBODY_NEXT, NO_STOP, TALK_CHIPS, agentTalk, chipForKey, handoffTalk, talkReply } from './agent-talk';
import type { Handoff } from './handoffs';
import { createMockOfficeState } from './preview';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAgent, type OfficeAudit, type OfficeSnapshot } from './state';

const alex: OfficeAgent = { id: 'collections-clerk', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: OFFICE_ANCHORS.collections.position, state: '' };
const desk = (agent: Partial<OfficeAgent> = {}, audit: OfficeAudit[] = [], handoffs: Handoff[] = []): OfficeSnapshot =>
  ({ ...INITIAL_OFFICE, agents: [{ ...alex, ...agent }], audit, handoffs });
const receipt = (id: string, decision: OfficeAudit['decision'], summary: string, ruleIds: string[] = []): OfficeAudit =>
  ({ id, agentId: alex.id, seatId: 'collections', action: 'act', decision, ruleIds, summary });
let seq = 0;
const handoff = (row: Partial<Handoff>): Handoff => ({
  handoffId: `private-${++seq}`, sequence: BigInt(seq), caseDisplayId: 'INV-1042', fromAgentId: 'intake-agent', toAgentId: 'extractor-agent',
  fromRole: 'intake', toRole: 'extractor', fromVoiceRole: 'intake_sorter', toVoiceRole: 'extractor', status: 'accepted', correction: false,
  createdAt: seq, reason: 'Invoice received', summary: 'Extract the invoice fields', line: 'Extract it.', ...row,
});
const replies = (talk: NonNullable<ReturnType<typeof agentTalk>>) => TALK_CHIPS.map(chip => talkReply(talk, chip.id).text);

describe('agent talk', () => {
  it('offers the three quick replies, bound to keys 1/2/3', () => {
    expect(TALK_CHIPS.map(chip => chip.label)).toEqual(['What are you working on?', 'Why did you stop?', "Who's next?"]);
    expect(['1', '2', '3', '4', '0', 'e'].map(chipForKey)).toEqual(['working', 'stopped', 'next', undefined, undefined, undefined]);
  });

  it('says so in character when there is nothing on the desk', () => {
    const talk = agentTalk(desk(), alex.id)!;
    expect(talk.speaker).toMatchObject({ name: 'Alex', role: 'Collections', tag: { kind: 'agent', id: alex.id } });
    expect(talk.greeting.text).toBe(`I'm Alex, collections. ${EMPTY_DESK}`);
    expect(talk.lines).toEqual([]);
    expect(replies(talk)).toEqual([EMPTY_DESK, EMPTY_DESK, EMPTY_DESK]);
    expect(agentTalk(desk(), 'gone')).toBeNull();
  });

  it('answers every chip from the agent state and receipts', () => {
    const talk = agentTalk(desk({ state: 'Reviewing invoice 1042' }, [receipt('a1', 'ALLOW', 'Called Northwind', ['CALL_HOURS'])]), alex.id)!;
    expect(talk.greeting.text).toBe("I'm Alex, collections. Right now: Reviewing invoice 1042 (Collections).");
    expect(talkReply(talk, 'working').text).toBe('Right now: Reviewing invoice 1042 (Collections).');
    expect(talkReply(talk, 'stopped').text).toBe(NO_STOP);
    expect(talkReply(talk, 'next').text).toBe(NOBODY_NEXT);
    expect(talk.lines).toEqual([{ id: 'audit-0', text: 'I was cleared: Called Northwind.', ruleIds: ['CALL_HOURS'], tone: 'info' }]);
  });

  it('explains an escalation with its rule id and who is next', () => {
    const mock = createMockOfficeState();
    mock.setTargetAnchor('dana');
    const talk = agentTalk(mock.source.getSnapshot(), alex.id)!;
    expect(talk.greeting.text).toBe("I'm Alex, collections. Right now: Four installments requested · awaiting Dana (Dana’s desk).");
    expect(talk.greeting.tone).toBe('passkey');
    expect(talkReply(talk, 'stopped')).toEqual({ id: 'stopped', tone: 'passkey', ruleIds: ['MAX_INSTALLMENTS'],
      text: "I stopped to escalate: Invoice 1042 · four installments → Dana. It's waiting at Dana’s desk (preview-escalation-1042)." });
    expect(talkReply(talk, 'next').text).toBe("Dana’s desk is next: my folder is waiting there (preview-escalation-1042).");
    expect(talk.lines[0]).toMatchObject({ text: 'I escalated: Invoice 1042 · four installments → Dana.', ruleIds: ['MAX_INSTALLMENTS'], tone: 'passkey' });
  });

  it('explains a denial with its rule id and keeps only the last three receipts, newest first', () => {
    const mock = createMockOfficeState();
    for (let i = 0; i < 4; i++) mock.denyTreasury();
    const talk = agentTalk(mock.source.getSnapshot(), alex.id)!;
    expect(talkReply(talk, 'stopped')).toEqual({ id: 'stopped', tone: 'fail', ruleIds: ['NOT_IN_BADGE'], text: 'I was refused: Treasury entry refused · controller only.' });
    expect(talk.lines).toHaveLength(3);
    expect(talk.lines.every(line => line.ruleIds.includes('NOT_IN_BADGE') && line.tone === 'fail')).toBe(true);
    expect(talk.askWhy).toBe('Why did Alex (collections-clerk) get DENY on “Treasury entry refused · controller only”?');
  });

  it('names the case for a seated agent waiting on Dana’s passkey, matching only its own handoffs', () => {
    const passkey = handoff({ fromAgentId: alex.id, fromRole: 'collections', toRole: 'reconciler', toAgentId: 'reconciler-agent', status: 'offered',
      reason: "Waiting on Dana's passkey", decisionRef: 'private-decision' });
    const other = handoff({ caseDisplayId: 'INV-9', reason: 'Not Alex' });
    const talk = agentTalk(desk({}, [], [passkey, other]), alex.id)!;
    expect(talk.greeting.text).toBe("I'm Alex, collections. I'm on INV-1042: waiting on Dana: Waiting on Dana's passkey.");
    expect(talkReply(talk, 'stopped').text).toBe("I'm waiting on Dana for INV-1042: Waiting on Dana's passkey.");
    expect(talkReply(talk, 'next').text).toBe("Dana is next on INV-1042: Waiting on Dana's passkey.");
    expect(JSON.stringify(talk)).not.toMatch(/private|Not Alex|INV-9/);
  });

  it('reports a rejected handoff with its error code', () => {
    const rows = [handoff({}), handoff({ fromRole: 'extractor', toRole: 'vendor', status: 'rejected', caseDisplayId: 'INV-1043',
      reason: 'Remit-to ••4821 does not match', summary: 'Extractor keeps the case', errorCode: 'VENDOR_MISMATCH' })];
    const talk = handoffTalk({ ...INITIAL_OFFICE, handoffs: rows }, 'extractor')!;
    expect(talk.speaker).toMatchObject({ name: 'Extractor', role: 'handoff team · Lobby', tag: { kind: 'handoff', actor: 'extractor' } });
    expect(talk.greeting.text).toBe("I'm Extractor, handoff team · lobby. I'm on INV-1043: the handoff to Vendor verifier was rejected (VENDOR_MISMATCH).");
    expect(talkReply(talk, 'stopped')).toEqual({ id: 'stopped', tone: 'fail', ruleIds: ['VENDOR_MISMATCH'],
      text: 'My handoff of INV-1043 to Vendor verifier was rejected: Remit-to ••4821 does not match.' });
    expect(talkReply(talk, 'next').text).toBe('No one is next on INV-1043: the handoff to Vendor verifier was rejected.');
    expect(talk.lines.map(line => line.text)).toEqual([
      'My handoff of INV-1043 to Vendor verifier was rejected: Remit-to ••4821 does not match.',
      'I took INV-1042 from Intake: Invoice received.',
    ]);
    expect(talk.lines[0]!.ruleIds).toEqual(['VENDOR_MISMATCH']);
  });

  it('marks a correction handoff and follows the row the figure is carrying', () => {
    const correction = handoff({ fromRole: 'payables', toRole: 'vendor', status: 'accepted', correction: true, caseDisplayId: 'INV-1044',
      reason: 'Missing tax form', summary: 'Return to vendor for correction' });
    const later = handoff({ fromRole: 'intake', toRole: 'payables', caseDisplayId: 'INV-1045', status: 'completed', summary: 'Ready to pay' });
    const snapshot = { ...INITIAL_OFFICE, handoffs: [correction, later] };
    const carrying = handoffTalk(snapshot, 'payables', correction)!;
    expect(carrying.greeting).toMatchObject({ tone: 'correction', text: "I'm Payables, handoff team · payables. I'm on INV-1044: Vendor verifier has it." });
    expect(talkReply(carrying, 'stopped').text).toBe(`${NO_STOP} My last handoff was a correction on INV-1044: Missing tax form.`);
    expect(talkReply(carrying, 'next')).toMatchObject({ tone: 'correction', text: 'Vendor verifier is next on INV-1044.' });
    expect(carrying.lines[1]!.text).toBe('Correction: Vendor verifier took INV-1044 from me: Missing tax form.');
    const idle = handoffTalk(snapshot, 'payables')!;
    expect(talkReply(idle, 'working').text).toBe('My last handoff: I finished INV-1045 from Intake: Ready to pay.');
    expect(talkReply(idle, 'next').text).toBe(`I finished INV-1045. ${NOBODY_NEXT}`);
    expect(handoffTalk(snapshot, 'auditor')).toBeNull();
  });

  it('lets Dana speak at the passkey step', () => {
    const passkey = handoff({ fromRole: 'payables', toRole: 'reconciler', status: 'offered', reason: 'Human approval escalation · waiting for Dana’s passkey', decisionRef: 'PASSKEY-42' });
    const talk = handoffTalk({ ...INITIAL_OFFICE, handoffs: [passkey] }, 'human')!;
    expect(talk.speaker.role).toBe('the human approver');
    expect(talkReply(talk, 'next').text).toBe("I'm next on INV-1042: Human approval escalation · waiting for Dana’s passkey.");
  });
});
