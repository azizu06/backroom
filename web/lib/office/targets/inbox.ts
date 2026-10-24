import { OFFICE_ANCHORS, type FloorPosition } from "../state";
import { defineTarget, type PlayPanelEntry } from "./types";

/** Inbox tray on the aisle-side left end of the Payables desk (desk-local x -0.8, z 0.3). */
export const INBOX_TRAY: FloorPosition = [OFFICE_ANCHORS.payables.center[0] - 0.8, OFFICE_ANCHORS.payables.center[1] + 0.3];
export const INBOX_TRAY_RADIUS = 0.4;
const MAX_ENTRIES = 8;

export const inboxTarget = defineTarget<{ kind: "inbox" }>({
  id: "inbox",
  candidates: ({ visible }) => visible.has("payables") ? [{ target: { kind: "inbox" } as const, position: INBOX_TRAY, radius: INBOX_TRAY_RADIUS }] : [],
  label: snapshot => `Open inbox tray · ${snapshot.inboxCount} items`,
  panel: snapshot => ({
    kind: "inbox", title: "Inbox tray", state: `${snapshot.inboxCount} items in the inbox`,
    // Preview and replay count items without carrying their receipts; say so instead of showing an empty list as "none".
    ...(snapshot.inboxCount > 0 && !snapshot.inboxReceipts?.length ? { task: `${snapshot.inboxCount} intake items are counted, but this feed carries no receipts for them.` } : {}),
    entries: (snapshot.inboxReceipts ?? []).slice(-MAX_ENTRIES).reverse().map((row): PlayPanelEntry =>
      ({ id: row.id, decision: row.decision, summary: row.summary, ruleIds: row.ruleIds })),
  }),
});
