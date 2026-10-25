import { FLOOR_FIXTURES } from "../layout";
import { defineTarget } from "./types";

/** GX10 rack against the east wall, clear of the pod and perimeter aisles. */
export const SERVER_ROOM = { position: [FLOOR_FIXTURES.server.x, FLOOR_FIXTURES.server.z] as const, size: { width: FLOOR_FIXTURES.server.width, depth: FLOOR_FIXTURES.server.depth } } as const;

export const serverTarget = defineTarget<{ kind: "server" }>({
  id: "server",
  candidates: () => [{ target: { kind: "server" }, position: SERVER_ROOM.position, radius: SERVER_ROOM.size.width / 2 }],
  label: () => "Check GX10 server",
  // Live GX10 numbers are not in the snapshot; the dialog reads them from GET /api/gx10.
  panel: () => ({ kind: "server", title: "GX10 server", entries: [] }),
});
