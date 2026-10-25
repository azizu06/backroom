import { OFFICE_ANCHORS, type AnchorId } from "../state";
import { auditEntries, defineTarget, valueText } from "./types";

/** A desk's interact radius is the circle inscribed in its footprint. */
import { DESK_SIZE } from "../metrics";
export { DESK_SIZE };
export const DESK_RADIUS = DESK_SIZE.depth / 2;
export const DESKS = ["collections", "payables", "vendor_onboarding", "dana"] as const satisfies readonly AnchorId[];

export const deskTarget = defineTarget<{ kind: "desk"; room: AnchorId }>({
  id: "desk",
  candidates: ({ visible }) => DESKS.filter(room => visible.has(room)).map(room => ({ target: { kind: "desk", room } as const, position: OFFICE_ANCHORS[room].center, radius: DESK_RADIUS })),
  key: target => `desk:${target.room}`,
  label: (_, target) => target.room === "dana" ? `Inspect ${OFFICE_ANCHORS.dana.name}` : `Inspect ${OFFICE_ANCHORS[target.room].name} desk`,
  panel(snapshot, target) {
    const badge = snapshot.badges.find(row => row.seatId === target.room);
    return {
      kind: "desk", title: OFFICE_ANCHORS[target.room].name,
      badge: badge && { policyVersion: badge.policyVersion, limits: Object.entries(badge.limits).map(([key, value]) => [key, valueText(value)] as const) },
      seated: snapshot.agents.filter(agent => agent.seatId === target.room).map(agent => ({ id: agent.id, name: agent.name, state: agent.state })),
      entries: auditEntries(snapshot, row => row.seatId === target.room),
    };
  },
});
