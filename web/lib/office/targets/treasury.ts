import { OFFICE_ANCHORS, matchingDenial, type FloorPosition } from "../state";
import { defineTarget } from "./types";

export const TREASURY_DOOR: FloorPosition = [5, 1.15];
export const DOOR_RADIUS = 0.65;

export const treasuryTarget = defineTarget<{ kind: "treasury" }>({
  id: "treasury",
  candidates: ({ visible }) => visible.has("treasury") ? [{ target: { kind: "treasury" } as const, position: TREASURY_DOOR, radius: DOOR_RADIUS }] : [],
  label: () => "Treasury door",
  panel(snapshot) {
    const denial = matchingDenial(snapshot, "treasury");
    const row = denial && snapshot.audit.find(entry => entry.id === denial.auditId);
    return {
      kind: "treasury", title: OFFICE_ANCHORS.treasury.name, locked: "Locked · Dana only",
      denial: row ? { id: row.id, decision: row.decision, summary: row.summary, ruleIds: row.ruleIds } : undefined,
      entries: [],
    };
  },
});
