import { defineTarget } from "./types";

/** GX10 server room footprint: scene.tsx mounts ServerRoom here and Play makes it solid and interactable. */
export const SERVER_ROOM = { position: [7.1, -0.8] as const, size: { width: 1.2, depth: 1.05 } } as const;

export const serverTarget = defineTarget<{ kind: "server" }>({
  id: "server",
  candidates: () => [{ target: { kind: "server" }, position: SERVER_ROOM.position, radius: SERVER_ROOM.size.width / 2 }],
  label: () => "Check GX10 server",
  // Live GX10 numbers are not in the snapshot; the dialog reads them from GET /api/gx10.
  panel: () => ({ kind: "server", title: "GX10 server", entries: [] }),
});
