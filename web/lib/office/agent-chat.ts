import { handoffAgentName, needsHandoffHuman, type Handoff, type HandoffAgentId, type HandoffRole } from './handoffs';
import type { HandoffPlan } from './handoff-plan';
import type { OfficeSnapshot } from './state';

/** Reading time stays constant even when the demo walk is sped up. */
export const AGENT_CHAT_MS = 3500;
export type AgentChatSource = 'Simulated' | 'Live handoff' | 'Replay' | 'Offline record';
export function agentChatSource(connection: OfficeSnapshot['connection'], scripted: boolean): AgentChatSource {
  return scripted || connection === 'preview' ? 'Simulated' : connection === 'live' ? 'Live handoff'
    : connection === 'replay' ? 'Replay' : 'Offline record';
}

const REVIEW: Record<HandoffRole, string> = {
  intake: 'I’ll sort the documents.', extractor: 'I’ll check the invoice fields.', vendor: 'I’ll review the vendor documents.',
  payables: 'I’ll review the payment evidence.', collections: 'I’ll review the contact record.',
  reconciler: 'I’ll compare the records.', auditor: 'I’ll review the audit evidence.',
};

/** Only the public display label is eligible; arbitrary case strings and free text are never echoed. */
export function agentChatCase(row: Handoff): string {
  const label = row.caseDisplayId.trim();
  if (/^(?:INV|CASE)-\d{1,12}$/i.test(label) || /^••[\p{L}\p{N}]{1,16}$/u.test(label)) return label;
  return 'this case';
}

export function agentChatMessages(row: Handoff) {
  const subject = agentChatCase(row), receiver = handoffAgentName(row.toRole);
  if (row.status === 'rejected') return {
    sender: `The handoff for ${subject} was rejected. Review needed.`,
    reply: 'Understood. This needs review.', senderStatus: 'Handoff rejected', receiverStatus: 'Review needed',
  };
  const waiting = needsHandoffHuman(row) && row.status !== 'completed';
  return {
    sender: `${row.correction ? 'Correction for' : 'Passing'} ${subject} to ${receiver}${row.correction ? ' for review' : ''}.`,
    reply: row.status === 'offered' ? 'I see the offer. Waiting for acceptance.'
      : waiting ? 'Got the documents. Human passkey approval is still required.'
        : row.status === 'completed' ? 'Got it. My turn is finished.' : `Got it. ${REVIEW[row.toRole]}`,
    senderStatus: row.correction ? 'Correction handoff' : 'Passing documents',
    receiverStatus: row.status === 'offered' ? 'Awaiting acceptance' : waiting ? 'Awaiting human'
      : row.status === 'completed' ? 'Turn finished' : 'Reviewing documents',
  };
}

export interface AgentChatCue {
  readonly actor: HandoffAgentId;
  readonly phase: 'sender' | 'reply';
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly status: string;
  readonly source: AgentChatSource;
}

/** Follow the existing trip and folder-pass times; this creates no motion or backend state. */
export function agentChatTimeline(plan: HandoffPlan, source: AgentChatSource): AgentChatCue[] {
  return plan.trips.flatMap(trip => {
    const row = trip.handoff, messages = agentChatMessages(row);
    const folder = plan.folders.find(entry => entry.handoffId === row.handoffId);
    const start = row.status === 'rejected' ? Math.max(trip.start, folder?.failAt ?? trip.start) : trip.start;
    if (!Number.isFinite(start)) return [];
    const pass = folder?.segments.find(segment => segment.kind === 'pass');
    const replyAt = Math.max(start + AGENT_CHAT_MS, row.status === 'rejected' ? start : pass?.end ?? trip.arrive);
    return [
      { actor: trip.courier, phase: 'sender' as const, start, end: start + AGENT_CHAT_MS,
        text: messages.sender, status: messages.senderStatus, source },
      { actor: trip.receiver, phase: 'reply' as const, start: replyAt, end: replyAt + AGENT_CHAT_MS,
        text: messages.reply, status: messages.receiverStatus, source },
    ];
  });
}

/** One latest line per actor; half-open windows make the sender/reply boundary unambiguous. */
export function sampleAgentChat(cues: readonly AgentChatCue[], now: number): AgentChatCue[] {
  const latest = new Map<HandoffAgentId, AgentChatCue>();
  for (const cue of cues) if (now >= cue.start && now < cue.end) {
    const previous = latest.get(cue.actor);
    if (!previous || cue.start >= previous.start) latest.set(cue.actor, cue);
  }
  return [...latest.values()];
}

export function nextAgentChatChange(cues: readonly AgentChatCue[], now: number): number | null {
  let next = Infinity;
  for (const cue of cues) for (const at of [cue.start, cue.end]) if (at > now && at < next) next = at;
  return Number.isFinite(next) ? next : null;
}
