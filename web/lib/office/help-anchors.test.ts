import { describe, expect, it } from 'vitest';
import { helpAnchorScrollTop } from './help-anchors';

describe('helpAnchorScrollTop', () => {
  const measurements = { scrollTop: 300, headingTop: 500, scrollportTop: 80, headerHeight: 72, navigationHeight: 90, maxScrollTop: 2000 };

  it('leaves the heading below both sticky regions and a reading gap', () => {
    const top = helpAnchorScrollTop(measurements);
    expect(top).toBe(546);
    expect(measurements.headingTop - (top - measurements.scrollTop))
      .toBe(measurements.scrollportTop + measurements.headerHeight + measurements.navigationHeight + 12);
  });

  it('accounts for wrapped mobile anchors and a resized header', () => {
    expect(helpAnchorScrollTop({ ...measurements, headerHeight: 96, navigationHeight: 160 })).toBe(452);
  });

  it('uses sheet-relative coordinates regardless of where the sheet sits on the page', () => {
    expect(helpAnchorScrollTop({ ...measurements, headingTop: 700, scrollportTop: 280 }))
      .toBe(helpAnchorScrollTop(measurements));
  });

  it('clamps at the start and end, including a sheet with no overflow', () => {
    expect(helpAnchorScrollTop({ ...measurements, headingTop: 0, scrollTop: 0 })).toBe(0);
    expect(helpAnchorScrollTop({ ...measurements, maxScrollTop: 200 })).toBe(200);
    expect(helpAnchorScrollTop({ ...measurements, maxScrollTop: 0 })).toBe(0);
  });
});
