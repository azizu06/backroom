import { handoffTalk } from "../agent-talk";
import { compareHandoffs, handoffAgentName, handoffStatus, needsHandoffHuman, statusLabel } from "../handoffs";
import { AGENT_RADIUS } from "./agent";
import { defineTarget } from "./types";

/** Public display fields only; identifiers remain internal to the row adapter and planner. */
export const handoffTarget = defineTarget<{ kind: "handoff"; actor: string }>({
  id: "handoff",
  candidates: ({ handoffAgents = [] }) => handoffAgents.map(agent => ({ target: { kind: "handoff", actor: agent.id } as const, position: agent.position, radius: AGENT_RADIUS })),
  key: target => `handoff:${target.actor}`,
  label: (_, target) => `Ask ${handoffAgentName(target.actor)} about the handoff`,
  panel(snapshot, target, handoffFor) {
    const rows = (snapshot.handoffs ?? []).filter(row => row.fromRole === target.actor || row.toRole === target.actor || (target.actor === "human" && needsHandoffHuman(row)));
    if (!rows.length) return null;
    const carrying = handoffFor?.(target.actor);
    const current = rows.find(row => row.handoffId === carrying?.handoffId) ?? [...rows].sort((a, b) => compareHandoffs(b, a))[0]!;
    return {
      kind: "handoff", title: `${handoffAgentName(target.actor)} · handoff`, state: statusLabel(current.status), talk: handoffTalk(snapshot, target.actor, current) ?? undefined,
      handoff: { correction: current.correction, from: handoffAgentName(current.fromRole), to: handoffAgentName(current.toRole), caseDisplayId: current.caseDisplayId,
        reason: current.reason, summary: current.summary, status: handoffStatus(current), errorCode: current.status === "rejected" ? current.errorCode : undefined },
      entries: rows.filter(row => row.caseDisplayId === current.caseDisplayId).sort((a, b) => compareHandoffs(b, a)).slice(0, 8).map((row, i) => ({
        id: `handoff-${i}`, decision: statusLabel(row.status).toUpperCase(),
        summary: `${row.caseDisplayId}: ${row.reason} · ${row.summary}${row.status === "completed" ? ` · ${handoffStatus(row)}` : ""}${row.status === "rejected" && row.errorCode ? ` · ${row.errorCode}` : ""}`, ruleIds: [],
      })),
    };
  },
});
