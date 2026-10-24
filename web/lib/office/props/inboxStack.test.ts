import { describe, expect, it } from 'vitest';
import { INBOX_LABEL_GLYPH, INBOX_LABEL_PX, INBOX_LABEL_WORLD, INBOX_SHEET_LIMIT, inboxLabelHeight, inboxSheets } from './inboxStack';

describe('inboxSheets', () => {
  it('uses whole sheets and caps the visual stack without changing the actual count', () => {
    for (const [count, sheets] of [[0, 0], [1, 1], [3.9, 3], [12, 12], [99, 12], [-5, 0]]) {
      expect(inboxSheets(count!)).toBe(sheets);
    }
    expect(inboxSheets(Infinity)).toBe(INBOX_SHEET_LIMIT);
    expect(inboxSheets(-Infinity)).toBe(0);
    expect(inboxSheets(NaN)).toBe(0);
  });
});

describe('inboxLabelHeight', () => {
  // Lobby focus and full-floor zooms from scene.tsx on a 1440x581 canvas.
  const focus = Math.min(1440 / 10, 581 / 8);
  const floor = Math.min(1440 / 22, 581 / 16);

  it('keeps the label the same pixel size at the focus and full-floor cameras', () => {
    for (const zoom of [focus, floor, 40]) expect(inboxLabelHeight(zoom, true) * zoom).toBeCloseTo(INBOX_LABEL_PX);
  });

  it('draws glyphs at least as tall as the old 10px DOM label at the full-floor camera', () => {
    expect(inboxLabelHeight(floor, true) * floor * INBOX_LABEL_GLYPH).toBeGreaterThanOrEqual(10);
  });

  it('uses a fixed world size for the perspective camera and bad zooms', () => {
    expect(inboxLabelHeight(1, false)).toBe(INBOX_LABEL_WORLD);
    for (const zoom of [0, -2, NaN, Infinity]) expect(inboxLabelHeight(zoom, true)).toBe(INBOX_LABEL_WORLD);
  });
});
