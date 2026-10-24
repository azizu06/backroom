import { OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from './state';

export interface LobbyStats {
  readonly inbox: number;
  readonly held: number;
  readonly denied: number;
  readonly escalations: number;
  readonly approvedByHuman?: number;
  readonly cashCollected?: number;
}

export function lobbyStats(snapshot: OfficeSnapshot): LobbyStats {
  const held = snapshot.audit.filter(row => row.decision === 'ESCALATE').length;
  const denied = snapshot.audit.filter(row => row.decision === 'DENY').length;
  const escalations = snapshot.agents.filter(agent => !!agent.escalationId).length;
  return {
    inbox: finiteCount(snapshot.inboxCount), held: finiteCount(held),
    denied: finiteCount(denied), escalations: finiteCount(escalations),
  };
}

function finiteCount(value: number): number { return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }

export function latestLobbyDecisions(snapshot: OfficeSnapshot) {
  const known = new Set(['ALLOW', 'DENY', 'ESCALATE', 'RECORDED']);
  return snapshot.audit.filter(row => known.has(row.decision)).slice(-5).reverse();
}

export function lobbyRoster(snapshot: OfficeSnapshot) {
  return snapshot.agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    desk: OFFICE_ANCHORS[agent.seatId as AnchorId]?.name ?? agent.seatId,
    state: agent.state,
    anchor: agent.targetAnchor,
    badge: snapshot.badges.find(badge => badge.seatId === agent.seatId),
  }));
}

export function lobbyModeLabel(connection: OfficeSnapshot['connection']): string | undefined {
  return connection === 'preview' ? 'Preview' : connection === 'replay' ? 'REPLAY' : undefined;
}
