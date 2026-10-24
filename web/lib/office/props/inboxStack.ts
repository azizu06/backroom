export const INBOX_SHEET_LIMIT = 12;

/** Paper is a bounded visual sample; the label still shows the snapshot's full count. */
export function inboxSheets(count: number): number {
  return Number.isNaN(count) ? 0 : Math.min(INBOX_SHEET_LIMIT, Math.max(0, Math.floor(count)));
}
