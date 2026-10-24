export const INBOX_SHEET_LIMIT = 12;

/** Paper is a bounded visual sample; the label still shows the snapshot's full count. */
export function inboxSheets(count: number): number {
  return Number.isNaN(count) ? 0 : Math.min(INBOX_SHEET_LIMIT, Math.max(0, Math.floor(count)));
}

/** On-screen height of the camera-facing inbox label under the orthographic cameras, in CSS pixels. */
export const INBOX_LABEL_PX = 24;
/** World height of the label under the first-person (perspective) camera, where zoom does not set pixel size. */
export const INBOX_LABEL_WORLD = 0.12;
/** The label's backing canvas is 4:1; the glyphs fill this share of its height. */
export const INBOX_LABEL_ASPECT = 4;
export const INBOX_LABEL_GLYPH = 0.62;

/** World height that keeps the label a fixed pixel size at any orthographic zoom, like the old DOM label. */
export function inboxLabelHeight(zoom: number, orthographic: boolean): number {
  return orthographic && Number.isFinite(zoom) && zoom > 0 ? INBOX_LABEL_PX / zoom : INBOX_LABEL_WORLD;
}
