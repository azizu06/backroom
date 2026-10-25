import type { FloorPosition } from "../state";
import { defineTarget } from "./types";
import { LOBBY_KIOSK } from "../layout";

/** Lobby counter (see the lobby footprint in officeColliders); hosts the read-only payment link. */
export const PAYLINK_KIOSK: FloorPosition = LOBBY_KIOSK;
export const PAYLINK_RADIUS = 0.7;

export const paylinkTarget = defineTarget<{ kind: "paylink" }>({
  id: "paylink",
  candidates: ({ visible }) => visible.has("lobby") ? [{ target: { kind: "paylink" } as const, position: PAYLINK_KIOSK, radius: PAYLINK_RADIUS }] : [],
  label: () => "Scan to pay · payment link kiosk",
  panel: () => ({ kind: "paylink", title: "Payment link kiosk", entries: [] }),
});
