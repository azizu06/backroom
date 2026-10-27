import { workstationApproach } from "../layout";
import { OPEN_SEATS, mySeat, screenStore, seatAt } from "../screens";
import { defineTarget } from "./types";

/** Standing at an open desk's chair. */
const WORKSTATION_RADIUS = 0.8;

/** Open desks: sit and share your screen, watch whoever sits there, or stand up again. View only (screens.ts). */
export const workstationTarget = defineTarget<{ kind: "workstation"; desk: number }>({
  id: "workstation",
  candidates: () => screenStore.getSnapshot().enabled
    ? OPEN_SEATS.map(desk => ({ target: { kind: "workstation", desk } as const, position: workstationApproach(desk), radius: WORKSTATION_RADIUS })) : [],
  key: target => `workstation:${target.desk}`,
  label: (_, target) => {
    const state = screenStore.getSnapshot(), seat = seatAt(state, target.desk);
    if (seat?.viewerId === state.selfId) return "Stop sharing your screen";
    if (seat) return `Watch ${seat.name}'s screen`;
    return mySeat(state) ? "Move here and share your screen" : "Sit and share your screen";
  },
  activate: target => {
    const state = screenStore.getSnapshot(), seat = seatAt(state, target.desk);
    screenStore.intend(seat?.viewerId === state.selfId ? { kind: "stand" } : seat ? { kind: "watch", desk: target.desk } : { kind: "sit", desk: target.desk });
  },
  panel: () => null,
});
