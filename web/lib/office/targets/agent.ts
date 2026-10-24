import { anchorLabel } from "../state";
import { auditEntries, defineTarget } from "./types";

/** Interact radius: the size of the thing. */
export const AGENT_RADIUS = 0.45;

export const agentTarget = defineTarget<{ kind: "agent"; id: string }>({
  id: "agent",
  candidates: ({ agents }) => agents.map(agent => ({ target: { kind: "agent", id: agent.id } as const, position: agent.position, radius: AGENT_RADIUS })),
  key: target => `agent:${target.id}`,
  label: (snapshot, target) => `Talk to ${snapshot.agents.find(row => row.id === target.id)?.name ?? target.id}`,
  panel(snapshot, target) {
    const agent = snapshot.agents.find(row => row.id === target.id);
    if (!agent) return null;
    return {
      kind: "agent", title: `${agent.name} · ${agent.id}`, state: agent.state,
      task: `Task · ${anchorLabel(agent.targetAnchor)}${agent.escalationId ? ` · escalation folder ${agent.escalationId}` : ""}`,
      entries: auditEntries(snapshot, row => row.agentId === agent.id),
    };
  },
});
