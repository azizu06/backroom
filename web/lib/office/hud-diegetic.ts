import { latestLobbyDecisions, lobbyModeLabel, lobbyStats } from './lobby-v2';
import { PALETTE, ROLES } from './palette';
import { OFFICE_ANCHORS, anchorLabel, isAnchorId, type OfficeAgent, type OfficeAudit, type OfficeSnapshot } from './state';

/**
 * HUD variant (c), diegetic: the facts the bottom dashboard strip used to show, shaped for in-world
 * signs. Pure view data only; the scene paints it and never decides anything from it.
 */
export type PlateTone = 'working' | 'idle' | 'held' | 'denied' | 'away' | 'stale';

export const PLATE_TONES: Record<PlateTone, { label: string; color: string }> = {
  idle: { label: 'Idle', color: PALETTE.mint },
  working: { label: 'Working', color: PALETTE.mint },
  held: { label: 'Held for a human', color: PALETTE.butter },
  denied: { label: 'Denied', color: ROLES.deny },
  away: { label: 'Away from desk', color: PALETTE.lavender },
  stale: { label: 'Last known', color: PALETTE.slate },
};

export interface DeskPlate {
  readonly agentId: string;
  readonly name: string;
  readonly desk: string;
  readonly task: string;
  readonly tone: PlateTone;
  /** Status line under the task, e.g. "Held for a human" or "Away · at Dana’s desk". */
  readonly status: string;
  /** Where the plate hangs: above the seat's desk, facing the aisle (+z). */
  readonly at: readonly [x: number, z: number];
}

/** Latest audit decision the agent produced, if any. */
function lastDecision(snapshot: OfficeSnapshot, agentId: string): OfficeAudit | undefined {
  for (let i = snapshot.audit.length - 1; i >= 0; i--) if (snapshot.audit[i]!.agentId === agentId) return snapshot.audit[i];
  return undefined;
}

export function deskPlate(snapshot: OfficeSnapshot, agent: OfficeAgent): DeskPlate {
  const seat = isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId] : undefined;
  const away = agent.targetAnchor !== agent.seatId;
  const last = lastDecision(snapshot, agent.id);
  const tone: PlateTone = snapshot.connection === 'disconnected' ? 'stale'
    : agent.escalationId ? 'held'
    : last?.decision === 'DENY' ? 'denied'
    : away || agent.state === 'Away' ? 'away' : /^(idle|inactive)$/i.test(agent.state) ? 'idle' : 'working';
  const status = tone === 'away' ? agent.state === 'Away' ? 'Away' : `Away · at ${anchorLabel(agent.targetAnchor)}`
    : tone === 'held' ? `${PLATE_TONES.held.label} · folder to ${anchorLabel(agent.targetAnchor)}`
    : tone === 'denied' ? `${PLATE_TONES.denied.label} · ${last?.ruleIds[0] ?? 'policy'}`
    : PLATE_TONES[tone].label;
  return {
    agentId: agent.id, name: agent.name, desk: seat?.name ?? agent.seatId, task: agent.state || 'Idle',
    tone, status, at: seat ? [seat.center[0], seat.center[1]] : [agent.pos[0], agent.pos[1]],
  };
}

/** One plate per seated agent, in roster order. */
export function deskPlates(snapshot: OfficeSnapshot): DeskPlate[] {
  return snapshot.agents.map(agent => deskPlate(snapshot, agent));
}

/** Text that changes the painted plate; the canvas redraws only when this changes. */
export function deskPlateKey(plate: DeskPlate): string {
  return [plate.name, plate.desk, plate.task, plate.tone, plate.status].join('|');
}

export interface NoticeBoard {
  readonly mode?: string;
  readonly stats: readonly { label: string; value: number; alert: boolean }[];
  readonly happened: readonly { id: string; decision: OfficeAudit['decision']; text: string }[];
  readonly empty: string;
}

export const NOTICE_DECISION_COLORS: Record<OfficeAudit['decision'], string> = {
  ALLOW: PALETTE.mint, DENY: ROLES.deny, ESCALATE: PALETTE.butter, RECORDED: PALETTE.lavender,
};
export const NOTICE_DECISION_LABELS: Record<OfficeAudit['decision'], string> = {
  ALLOW: 'ALLOW', DENY: 'DENY', ESCALATE: 'HOLD', RECORDED: 'REC',
};

/** "Today at Backroom" and "What happened", for the lobby notice board. Same sources as the lobby strip. */
export function noticeBoard(snapshot: OfficeSnapshot, rows = 4): NoticeBoard {
  const stats = lobbyStats(snapshot);
  return {
    mode: lobbyModeLabel(snapshot.connection),
    stats: [
      { label: 'Inbox', value: stats.inbox, alert: false },
      { label: 'Held', value: stats.held, alert: stats.held > 0 },
      { label: 'Denied', value: stats.denied, alert: stats.denied > 0 },
      { label: 'Escalations', value: stats.escalations, alert: stats.escalations > 0 },
    ],
    happened: latestLobbyDecisions(snapshot).slice(0, rows).map(row => ({
      id: row.id, decision: row.decision, text: row.summary || row.ruleIds.join(' · ') || 'No rule recorded',
    })),
    empty: snapshot.connection === 'connecting' ? 'Waiting for office state…' : 'No decisions received yet.',
  };
}

export function noticeBoardKey(board: NoticeBoard): string {
  return JSON.stringify(board);
}

/** Wrap at words, split long identifiers, and ellipsize overflow without ever shrinking the font. */
export function canvasTextLines(text: string, measure: (text: string) => number, width: number, maxLines: number): string[] {
  if (width <= 0 || !Number.isFinite(maxLines) || maxLines < 1) return [];
  maxLines = Math.floor(maxLines);
  let rest = text.trim().replace(/\s+/g, ' ');
  const lines: string[] = [];
  while (rest && lines.length < maxLines) {
    if (measure(rest) <= width) { lines.push(rest); break; }
    let end = rest.length;
    const last = lines.length === maxLines - 1;
    while (end > 0 && measure(rest.slice(0, end).trimEnd() + (last ? '…' : '')) > width) end--;
    if (!end) { if (last && measure('…') <= width) lines.push('…'); break; }
    const space = rest.lastIndexOf(' ', end);
    if (space > 0) end = space;
    lines.push(rest.slice(0, end).trimEnd() + (last ? '…' : ''));
    rest = rest.slice(end).trimStart();
  }
  return lines;
}
