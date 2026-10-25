import { plainWords } from './display';
import type { OfficeSnapshot } from './state';
import type { StoryChapter } from './story';

export interface StoryEvidence { readonly label: string; readonly href?: string }

/** Read received rows only; a scripted chapter is never evidence of a decision. */
export function recordedStoryDecision(chapter: StoryChapter, snapshot: OfficeSnapshot): StoryEvidence {
  const entry = snapshot.audit.findLast(row =>
    chapter.id === 'treasury' ? row.decision === 'DENY' && row.room === 'treasury' && row.action === 'request_room_entry'
      : chapter.id === 'dana' ? row.decision === 'ESCALATE'
      : chapter.id === 'vendor' && row.ruleIds.includes('BANK_CHANGE_HOLD'));
  if (entry) return {
    label: `Recorded: ${entry.ruleIds.map(plainWords).join(', ') || 'Human review requested'}`,
    href: `/audit?entry=${encodeURIComponent(entry.id)}#audit-replay`,
  };
  // An agent's escalation id confirms a folder, but does not identify an audit receipt.
  const agent = chapter.id === 'dana' ? snapshot.agents.find(row => row.escalationId) : undefined;
  if (agent) return { label: 'Recorded: sent to Dana · receipt unavailable' };
  return { label: 'Not recorded in this session' };
}
