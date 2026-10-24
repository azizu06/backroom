/**
 * Conversation lines for talking to an agent in Play. Pure and deterministic: every sentence is built from
 * snapshot rows (agent state, audit receipts, public handoff rows) and never invents a fact. When there is
 * no data the agent says so in character. View only: nothing here writes state or calls a model.
 */
import { HANDOFF_AGENTS, HUMAN, compareHandoffs, handoffAgentName, isHandoffAgent, needsHandoffHuman, type Handoff } from './handoffs';
import { OFFICE_ANCHORS, anchorLabel, isAnchorId, type OfficeAudit, type OfficeSnapshot } from './state';

export type TalkChip = 'working' | 'stopped' | 'next';
export const TALK_CHIPS: readonly { readonly id: TalkChip; readonly label: string }[] = [
  { id: 'working', label: 'What are you working on?' },
  { id: 'stopped', label: 'Why did you stop?' },
  { id: 'next', label: "Who's next?" },
];
/** Same tones as the handoff speech bubbles (handoffs.css). */
export type TalkTone = 'info' | 'fail' | 'passkey' | 'correction';
export interface TalkLine {
  readonly id: string;
  readonly text: string;
  readonly ruleIds: readonly string[];
  readonly tone: TalkTone;
  /** Public audit entry ids this line cites (never handoff or decision ids). */
  readonly receiptIds: readonly string[];
}
export type TalkSpeakerTag = { readonly kind: 'agent'; readonly id: string } | { readonly kind: 'handoff'; readonly actor: string };
export interface AgentTalk {
  readonly speaker: { readonly name: string; readonly role: string; readonly color: string; readonly tag: TalkSpeakerTag };
  readonly greeting: TalkLine;
  /** Up to three recent receipts or handoffs, newest first, in the agent's voice. */
  readonly lines: readonly TalkLine[];
  readonly replies: Readonly<Record<TalkChip, TalkLine>>;
  /** Suggested question for the lobby's grounded ask-why flow. */
  readonly askWhy: string;
}

export const EMPTY_DESK = 'Nothing on my desk right now.';
export const NO_STOP = 'Nothing in my record says I stopped.';
export const NOBODY_NEXT = 'Nobody is queued after me in my record.';
const RECENT = 3;

type Relation = 'from' | 'to' | 'human';
interface Desk {
  readonly name: string;
  readonly state: string;
  readonly target?: string;
  readonly escalation?: { readonly id: string; readonly anchor: string };
  /** Oldest first, as received. */
  readonly audit: readonly OfficeAudit[];
  /** Sequence order, oldest first. */
  readonly handoffs: readonly Handoff[];
  readonly focus?: Handoff;
  readonly relation: (row: Handoff) => Relation;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
const caseName = (row: Handoff) => row.caseDisplayId || 'a case';
const line = (id: string, text: string, tone: TalkTone = 'info', ruleIds: readonly string[] = [], receiptIds: readonly string[] = []): TalkLine => ({ id, text: sentence(text), ruleIds, tone, receiptIds });
const codes = (row: Handoff) => row.status === 'rejected' && row.errorCode ? [row.errorCode] : [];
const waitingOnHuman = (row: Handoff) => row.status !== 'completed' && row.status !== 'rejected' && needsHandoffHuman(row);

function auditLine(row: OfficeAudit, i: number): TalkLine {
  const id = `audit-${i}`;
  switch (row.decision) {
    case 'DENY': return line(id, `I was refused: ${row.summary}`, 'fail', row.ruleIds, [row.id]);
    case 'ESCALATE': return line(id, `I escalated: ${row.summary}`, 'passkey', row.ruleIds, [row.id]);
    case 'ALLOW': return line(id, `I was cleared: ${row.summary}`, 'info', row.ruleIds, [row.id]);
    default: return line(id, `On the record: ${row.summary}`, 'info', row.ruleIds, [row.id]);
  }
}

function handoffSentence(row: Handoff, relation: Relation): string {
  const from = handoffAgentName(row.fromRole), to = handoffAgentName(row.toRole), name = caseName(row);
  const text = relation === 'human' ? `${from} → ${to} on ${name} needs me: ${row.reason}`
    : relation === 'from' ? {
      offered: `I offered ${name} to ${to}: ${row.reason}`,
      accepted: `${to} took ${name} from me: ${row.reason}`,
      completed: `I handed ${name} to ${to}, and ${to} finished its turn: ${row.summary}`,
      rejected: `My handoff of ${name} to ${to} was rejected: ${row.reason}`,
    }[row.status] : {
      offered: `${from} offered me ${name}: ${row.reason}`,
      accepted: `I took ${name} from ${from}: ${row.reason}`,
      completed: `I finished ${name} from ${from}: ${row.summary}`,
      rejected: `${from}'s handoff of ${name} to me was rejected: ${row.reason}`,
    }[row.status];
  return `${row.correction ? 'Correction: ' : ''}${text}`;
}
function handoffTone(row: Handoff): TalkTone {
  return row.status === 'rejected' ? 'fail' : waitingOnHuman(row) ? 'passkey' : row.correction ? 'correction' : 'info';
}
function handoffLine(row: Handoff, relation: Relation, i: number): TalkLine {
  return line(`handoff-${i}`, handoffSentence(row, relation), handoffTone(row), codes(row));
}

/** Where the speaker's current (focus or newest) handoff stands, from their side. */
function caseStatus(row: Handoff, relation: Relation): string {
  const from = handoffAgentName(row.fromRole), to = handoffAgentName(row.toRole);
  if (waitingOnHuman(row)) return relation === 'human' ? `${from} → ${to} needs me: ${row.reason}` : `waiting on ${handoffAgentName(HUMAN)}: ${row.reason}`;
  if (row.status === 'rejected') return `the handoff ${relation === 'to' ? `from ${from}` : `to ${to}`} was rejected${row.errorCode ? ` (${row.errorCode})` : ''}`;
  if (row.status === 'offered') return relation === 'to' ? `${from} just offered it to me` : `waiting for ${to} to take it`;
  if (row.status === 'accepted') return relation === 'to' ? `I took it from ${from}` : `${to} has it`;
  return relation === 'to' ? `I finished my turn` : `${to} finished its turn`;
}

function latest(desk: Desk): Handoff | undefined {
  return desk.focus ?? desk.handoffs.at(-1);
}
function lines(desk: Desk): TalkLine[] {
  const receipts = [...desk.audit].reverse().slice(0, RECENT).map(auditLine);
  const handoffs = [...desk.handoffs].reverse().slice(0, RECENT).map((row, i) => handoffLine(row, desk.relation(row), i));
  return [...receipts, ...handoffs].slice(0, RECENT);
}
const isEmpty = (desk: Desk) => !desk.state.trim() && !desk.audit.length && !desk.handoffs.length;

function working(desk: Desk): TalkLine {
  if (isEmpty(desk)) return line('working', EMPTY_DESK);
  const parts: string[] = [];
  let tone: TalkTone = 'info';
  if (desk.state.trim()) parts.push(sentence(`Right now: ${desk.state.trim()}${desk.target ? ` (${anchorLabel(desk.target)})` : ''}`));
  const row = latest(desk);
  if (row && (row.status !== 'completed' || !parts.length)) {
    parts.push(sentence(row.status === 'completed' ? `My last handoff: ${handoffSentence(row, desk.relation(row))}` : `I'm on ${caseName(row)}: ${caseStatus(row, desk.relation(row))}`));
    tone = handoffTone(row);
  }
  if (desk.escalation) tone = 'passkey';
  if (!parts.length) {
    const last = desk.audit.at(-1)!;
    return line('working', sentence(`My last receipt: ${last.summary}`), tone, [], [last.id]);
  }
  return line('working', parts.join(' '), tone);
}

function stopped(desk: Desk): TalkLine {
  if (isEmpty(desk)) return line('stopped', EMPTY_DESK);
  const lastAudit = desk.audit.at(-1);
  if (desk.escalation) {
    const receipt = desk.audit.findLast(row => row.decision === 'ESCALATE');
    const where = `${anchorLabel(desk.escalation.anchor)} (${desk.escalation.id})`;
    return receipt ? line('stopped', `I stopped to escalate: ${sentence(receipt.summary)} It's waiting at ${where}`, 'passkey', receipt.ruleIds, [receipt.id])
      : line('stopped', `My folder is waiting at ${where}`, 'passkey');
  }
  if (lastAudit?.decision === 'DENY') return line('stopped', `I was refused: ${lastAudit.summary}`, 'fail', lastAudit.ruleIds, [lastAudit.id]);
  const row = latest(desk);
  if (row) {
    const relation = desk.relation(row);
    if (row.status === 'rejected') return line('stopped', handoffSentence(row, relation), 'fail', codes(row));
    if (waitingOnHuman(row)) return line('stopped', relation === 'human' ? `I haven't stopped; ${caseName(row)} needs me: ${row.reason}` : `I'm waiting on ${handoffAgentName(HUMAN)} for ${caseName(row)}: ${row.reason}`, 'passkey');
    if (row.correction) return line('stopped', `${NO_STOP} My last handoff was a correction on ${caseName(row)}: ${row.reason}`, 'correction');
  }
  return line('stopped', NO_STOP);
}

function next(desk: Desk): TalkLine {
  if (isEmpty(desk)) return line('next', EMPTY_DESK);
  if (desk.escalation) return line('next', `${anchorLabel(desk.escalation.anchor)} is next: my folder is waiting there (${desk.escalation.id})`, 'passkey');
  const row = latest(desk);
  if (!row) return line('next', NOBODY_NEXT);
  const relation = desk.relation(row), name = caseName(row);
  const from = handoffAgentName(row.fromRole), to = handoffAgentName(row.toRole);
  if (waitingOnHuman(row)) return line('next', relation === 'human' ? `I'm next on ${name}: ${row.reason}` : `${handoffAgentName(HUMAN)} is next on ${name}: ${row.reason}`, 'passkey');
  if (row.status === 'rejected') return line('next', `No one is next on ${name}: the handoff ${relation === 'to' ? `from ${from}` : `to ${to}`} was rejected`, 'fail', codes(row));
  const tone: TalkTone = row.correction ? 'correction' : 'info';
  if (row.status === 'completed') return line('next', `${relation === 'to' ? `I finished ${name}` : `${to} finished its turn on ${name}`}. ${NOBODY_NEXT}`, tone);
  if (relation === 'to') return line('next', row.status === 'offered' ? `I'm next on ${name}; ${from} offered it to me` : `I'm on ${name} now`, tone);
  return line('next', `${to} is next on ${name}`, tone);
}

function talk(desk: Desk, speaker: AgentTalk['speaker'], askWhy: string): AgentTalk {
  const now = working(desk);
  const intro = sentence(`I'm ${speaker.name}, ${speaker.role.toLowerCase()}`);
  return {
    speaker, greeting: line('greeting', `${intro} ${now.text}`, now.tone), lines: lines(desk),
    replies: { working: now, stopped: stopped(desk), next: next(desk) }, askWhy,
  };
}
function sorted(rows: readonly Handoff[]) { return [...rows].sort(compareHandoffs); }

/** A seated office agent (snapshot.agents). Handoff rows count only when they name this agent's id. */
export function agentTalk(snapshot: OfficeSnapshot, agentId: string): AgentTalk | null {
  const agent = snapshot.agents.find(row => row.id === agentId);
  if (!agent) return null;
  const handoffs = sorted((snapshot.handoffs ?? []).filter(row => row.fromAgentId === agent.id || row.toAgentId === agent.id));
  const audit = snapshot.audit.filter(row => row.agentId === agent.id);
  const desk: Desk = {
    name: agent.name, state: agent.state, target: agent.targetAnchor, audit, handoffs,
    escalation: agent.escalationId ? { id: agent.escalationId, anchor: agent.targetAnchor } : undefined,
    relation: row => row.fromAgentId === agent.id ? 'from' : 'to',
  };
  const color = isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId].color : '#9aa38f';
  const last = audit.at(-1);
  const askWhy = last ? `Why did ${agent.name} (${agent.id}) get ${last.decision} on “${last.summary}”?` : `What has ${agent.name} (${agent.id}) done, and why?`;
  return talk(desk, { name: agent.name, role: anchorLabel(agent.seatId), color, tag: { kind: 'agent', id: agent.id } }, askWhy);
}

/** A handoff-team figure (or Dana at the passkey step); `focus` is the row it is carrying, if any. */
export function handoffTalk(snapshot: OfficeSnapshot, actor: string, focus?: Handoff): AgentTalk | null {
  const rows = sorted((snapshot.handoffs ?? []).filter(row => row.fromRole === actor || row.toRole === actor || (actor === HUMAN && needsHandoffHuman(row))));
  if (!rows.length) return null;
  const current = rows.find(row => row.handoffId === focus?.handoffId);
  const desk: Desk = {
    name: handoffAgentName(actor), state: '', audit: [], handoffs: rows, focus: current,
    relation: row => row.fromRole === actor ? 'from' : row.toRole === actor ? 'to' : 'human',
  };
  const known = isHandoffAgent(actor) ? HANDOFF_AGENTS[actor] : undefined;
  const role = actor === HUMAN ? 'the human approver' : `handoff team · ${known ? anchorLabel(known.room) : 'office'}`;
  const row = current ?? rows.at(-1)!;
  const askWhy = `Why was ${caseName(row)} handed from ${handoffAgentName(row.fromRole)} to ${handoffAgentName(row.toRole)}?`;
  return talk(desk, { name: handoffAgentName(actor), role, color: known?.color ?? '#9aa38f', tag: { kind: 'handoff', actor } }, askWhy);
}

export function talkReply(conversation: AgentTalk, chip: TalkChip): TalkLine {
  return conversation.replies[chip];
}
/** Chip for a 1/2/3 key press, if any. */
export function chipForKey(key: string): TalkChip | undefined {
  const index = Number(key) - 1;
  return Number.isInteger(index) ? TALK_CHIPS[index]?.id : undefined;
}
