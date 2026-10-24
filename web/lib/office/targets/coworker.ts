import type { PresencePeer } from "../presence";
import { defineTarget, type CoworkerSpot } from "./types";

/** Soft target: coworkers are never solid, and agents and furniture win exact ties (registry order). */
export const COWORKER_RADIUS = 0.4;

/** Other viewers walking in Play, as Play target spots. */
export function coworkerSpots(peers: readonly PresencePeer[]): CoworkerSpot[] {
  return peers.filter(peer => peer.mode === "play").map(peer => ({ id: peer.viewerId, name: peer.name, position: [peer.x, peer.z] as const }));
}

export const coworkerTarget = defineTarget<{ kind: "coworker"; id: string; name: string }>({
  id: "coworker",
  candidates: ({ coworkers = [] }) => coworkers.map(spot => ({ target: { kind: "coworker", id: spot.id, name: spot.name } as const, position: spot.position, radius: COWORKER_RADIUS })),
  key: target => `coworker:${target.id}`,
  label: (_, target) => `Say hi to ${target.name}`,
  panel: (_, target) => ({ kind: "coworker", title: target.name, task: "Text chat reaches viewers within 6 m.", greeting: `Hi ${target.name}!`, entries: [] }),
});
