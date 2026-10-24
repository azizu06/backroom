import { OFFICE_ANCHORS, anchorLabel, visibleRooms, type OfficeAudit, type OfficeSnapshot, type SeatId } from '../state';
import type { OfficePropInteraction } from './interact';
import { truncateSummary } from './whiteboard';

export const MONITOR_DESKS = ['collections', 'payables', 'vendor_onboarding', 'dana'] as const;
export type MonitorDesk = typeof MONITOR_DESKS[number];
export const MONITOR_LINE_MAX = 26;
export const MONITOR_MAX_LINES = 4;
/** Fits inside the desk width; both the housing and texture use this transform. */
export const MONITOR_FACE = { width: 1.8, height: 1.08, x: -0.15, y: 1.54, z: -0.23 } as const;
export const MONITOR_TEXTURE = { width: 512, height: 320, overviewFont: 132 } as const;
/** In front of the screen (desk-local +z), just outside the desk footprint (half depth 0.525). */
const MONITOR_STAND: readonly [x: number, z: number] = [-0.35, 0.85];

export type MonitorLineKind = 'agent' | 'away' | 'folder' | 'idle' | 'awaiting' | 'escalation';
export interface MonitorLine { kind: MonitorLineKind; text: string }
export type MonitorStatusKey = 'allow' | 'deny' | 'escalate' | 'recorded';
export interface MonitorStatus { decision: OfficeAudit['decision']; key: MonitorStatusKey }
export interface MonitorScreen {
  heading: string;
  /** At most MONITOR_MAX_LINES, each at most MONITOR_LINE_MAX characters. */
  lines: readonly MonitorLine[];
  status: MonitorStatus | null;
}

const LINE_LABELS: Record<MonitorLineKind, string> = {
  agent: 'Agent', away: 'Away', folder: 'Folder', idle: 'Status', awaiting: 'Awaiting', escalation: 'Escalation',
};
const line = (kind: MonitorLineKind, text: string): MonitorLine => ({ kind, text: truncateSummary(text, MONITOR_LINE_MAX) });
const status = (row: OfficeAudit | undefined): MonitorStatus | null =>
  row ? { decision: row.decision, key: row.decision.toLowerCase() as MonitorStatusKey } : null;

/** Plain display data for one desk screen, read only from the snapshot. */
export function monitorScreen(snapshot: OfficeSnapshot, room: MonitorDesk): MonitorScreen {
  const heading = OFFICE_ANCHORS[room].name;
  if (room === 'dana') {
    const awaiting = snapshot.agents.filter(agent => agent.escalationId).length;
    // The newest escalation and its pill show only while a folder is actually waiting; no stale pill afterwards.
    const newest = awaiting ? snapshot.audit.findLast(row => row.decision === 'ESCALATE') : undefined;
    return {
      heading,
      lines: [line('awaiting', `Awaiting you: ${awaiting}`), ...newest ? [line('escalation', newest.summary)] : awaiting ? [] : [line('idle', 'Idle')]],
      status: status(newest),
    };
  }
  const seat: SeatId = room;
  const seated = snapshot.agents.filter(agent => agent.seatId === seat);
  const lines = seated.length ? seated.flatMap(agent => [
    line('agent', `${agent.name} · ${agent.state}`),
    ...agent.targetAnchor !== seat ? [line('away', `→ ${anchorLabel(agent.targetAnchor)}`)] : [],
    ...agent.escalationId ? [line('folder', 'Folder → Dana')] : [],
  ]) : [line('idle', 'Idle')];
  return { heading, lines: lines.slice(0, MONITOR_MAX_LINES), status: status(snapshot.audit.findLast(row => row.seatId === seat)) };
}

/** Stable key for redrawing a screen only when its display data changes. */
export function monitorScreenKey(screen: MonitorScreen): string {
  return JSON.stringify(screen);
}

/** Two short readouts at overview; full task lines remain on the focused screen and in its panel. */
export function monitorOverview(screen: MonitorScreen): readonly [string, string] {
  const agent = screen.lines.find(entry => entry.kind === 'agent');
  const [name, state] = agent?.text.split(' · ') ?? [];
  const waiting = screen.lines.find(entry => entry.kind === 'awaiting');
  const heading = name || (waiting ? 'Dana' : 'Idle');
  const decision = screen.status?.decision;
  const detail = decision === 'ESCALATE' ? 'HOLD' : decision === 'RECORDED' ? 'LOGGED' : decision;
  return [heading, detail || (waiting ? `Wait: ${waiting.text.split(': ').at(-1)}` : screen.lines.some(entry => entry.kind === 'folder') ? 'Folder' : screen.lines.some(entry => entry.kind === 'away') ? 'Away' : state || 'Idle')];
}

/** Floor (x, z) in front of a desk screen, following the desk's rotation (PI for Dana's desk). */
export function monitorStandPosition(room: MonitorDesk): readonly [x: number, z: number] {
  const [cx, cz] = OFFICE_ANCHORS[room].center;
  const flip = room === 'dana' ? -1 : 1;
  return [cx + flip * MONITOR_STAND[0], cz + flip * MONITOR_STAND[1]];
}

export function monitorInteraction(room: MonitorDesk): OfficePropInteraction {
  const name = OFFICE_ANCHORS[room].name;
  return {
    id: `monitor:${room}`,
    prompt: `Read ${name} screen`,
    position: monitorStandPosition(room),
    radius: 1.4,
    visible: snapshot => visibleRooms(snapshot).includes(room),
    panel(snapshot) {
      const screen = monitorScreen(snapshot, room);
      return {
        title: screen.heading,
        rows: [
          ...screen.lines.map(entry => ({ label: LINE_LABELS[entry.kind], value: entry.text })),
          ...screen.status ? [{ label: 'Latest', value: screen.status.decision }] : [],
        ],
      };
    },
  };
}
