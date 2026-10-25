import { OFFICE_ANCHORS, anchorLabel, matchingDenial, type AnchorId, type OfficeAgent, type OfficeSnapshot } from './state';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function seatLabel(agent: OfficeAgent): string {
  return `${agent.name}, ${agent.state}${agent.escalationId ? `, escalation folder to ${anchorLabel(agent.targetAnchor)}` : ''}`;
}

export function roomLabel(room: AnchorId, snapshot: OfficeSnapshot): string {
  const badge = snapshot.badges.find(row => row.seatId === room);
  const details = badge ? `badge v${badge.policyVersion} · open limits`
    : room === 'treasury' ? 'locked, Dana only'
    : room === 'lobby' ? 'audit wall and inbox'
    : room === 'dana' ? 'human approval' : 'open details';
  return `${OFFICE_ANCHORS[room].name} · ${details}${matchingDenial(snapshot, room) ? ' · entry denied' : ''}`;
}

export function isCloseKey(key: string): boolean {
  return key === 'Escape' || key === 'Esc';
}

export function cameraAlpha(deltaSeconds: number, reduced: boolean): number {
  return reduced ? 1 : 1 - Math.exp(-7 * Math.min(deltaSeconds, 0.1));
}

export function doorHighlight(ageMs: number, reduced: boolean): { visible: boolean; opacity: number } {
  const visible = ageMs >= 0 && ageMs < 4500;
  return { visible, opacity: reduced ? 0.8 : visible && Math.floor(ageMs / 300) % 2 === 0 ? 0.95 : 0.65 };
}

export function legSwing(distance: number, i: number, moving: boolean, reduced: boolean): number {
  return reduced || !moving ? 0 : Math.sin(distance * 9 + i * Math.PI) * 0.38;
}
