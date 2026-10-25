import { agentTalk } from "../agent-talk";
import { agentCards } from "../agent-cards";
import { auditEntries, defineTarget } from "./types";

/** Interact radius: the size of the thing. */
export const AGENT_RADIUS = 0.45;

export const agentTarget = defineTarget<{ kind: "agent"; id: string }>({
  id: "agent",
  candidates: ({ agents }) => agents.map(agent => ({ target: { kind: "agent", id: agent.id } as const, position: agent.position, radius: AGENT_RADIUS })),
  key: target => `agent:${target.id}`,
  label: (snapshot, target) => `Talk to ${snapshot.agents.find(row => row.id === target.id)?.name ?? target.id}${agentCards(snapshot, Date.now()).find(card => card.agentId === target.id)?.tag === 'NEEDS YOU' ? ' (needs you)' : ''}`,
  panel(snapshot, target) {
    const talk = agentTalk(snapshot, target.id);
    if (!talk) return null;
    return { kind: "agent", title: `Talking with ${talk.speaker.name}`, talk, entries: auditEntries(snapshot, row => row.agentId === target.id) };
  },
});
