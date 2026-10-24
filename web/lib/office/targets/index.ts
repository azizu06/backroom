/**
 * Play target registry. A new interactable adds one module in this folder (see types.ts) and one entry
 * below. Order matters: it is the candidate order pickTarget breaks exact ties with (agents always win).
 */
import { agentTarget } from "./agent";
import { coworkerTarget } from "./coworker";
import { deskTarget } from "./desk";
import { handoffTarget } from "./handoff";
import { paylinkTarget } from "./paylink";
import { phoneTarget } from "./phone";
import { serverTarget } from "./server";
import { treasuryTarget } from "./treasury";
import type { PlayTargetModule } from "./types";

export const PLAY_TARGETS = [
  agentTarget,
  handoffTarget,
  deskTarget,
  treasuryTarget,
  paylinkTarget,
  phoneTarget,
  serverTarget,
  coworkerTarget,
] as const;

type TargetOf<M> = M extends PlayTargetModule<infer T> ? T : never;
export type PlayTarget = TargetOf<typeof PLAY_TARGETS[number]>;
/** The registry widened to the full target union, for dispatch by kind. */
export const PLAY_TARGET_LIST: readonly PlayTargetModule<PlayTarget>[] = PLAY_TARGETS;
export function playTargetModule(kind: PlayTarget["kind"]): PlayTargetModule<PlayTarget> {
  return PLAY_TARGET_LIST.find(target => target.id === kind)!;
}
