import { describe, expect, it } from 'vitest';
import { MAX_PROP_TEXTURE, canvasTextLines, canvasTextureSize } from './readability';
import { MONITOR_FACE, MONITOR_TEXTURE } from './monitors';

const measure = (text: string) => text.length * 10;

describe('canvas text layout', () => {
  it('wraps rule words instead of reducing the font', () => {
    expect(canvasTextLines('NOT IN BADGE', measure, 60, 2)).toEqual(['NOT IN', 'BADGE']);
    expect(canvasTextLines('  NOT   IN\nBADGE  ', measure, 60, 2)).toEqual(['NOT IN', 'BADGE']);
  });

  it('splits long identifiers and ellipsizes excess rows within the measured width', () => {
    expect(canvasTextLines('ABCDEFGHIJK', measure, 40, 3)).toEqual(['ABCD', 'EFGH', 'IJK']);
    expect(canvasTextLines('ABCDEFGHIJKLM', measure, 40, 3)).toEqual(['ABCD', 'EFGH', 'IJK…']);
    expect(canvasTextLines('A wide last line', measure, 60, 2)).toEqual(['A wide', 'last…']);
    for (const text of ['Reviewing invoice 1042', 'CONTROLLER_ONLY', 'Alex', '']) {
      const lines = canvasTextLines(text, measure, 60, 2);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(60);
    }
  });

  it('handles empty input, exact fits and spaces narrower than an ellipsis', () => {
    expect(canvasTextLines('', measure, 60, 2)).toEqual([]);
    expect(canvasTextLines('DENIED', measure, 60, 1)).toEqual(['DENIED']);
    expect(canvasTextLines('DENIED', measure, 10, 1)).toEqual(['…']);
    expect(canvasTextLines('DENIED', measure, 5, 1)).toEqual([]);
    expect(canvasTextLines('DENIED', measure, 60, 0)).toEqual([]);
  });
});

describe('prop texture budget', () => {
  it('keeps normal sizes and caps larger canvases while preserving aspect', () => {
    expect(canvasTextureSize(512, 320)).toEqual({ width: 512, height: 320 });
    expect(canvasTextureSize(4096, 2048)).toEqual({ width: MAX_PROP_TEXTURE, height: MAX_PROP_TEXTURE / 2 });
    expect(canvasTextureSize(200, 4000)).toEqual({ width: 51, height: MAX_PROP_TEXTURE });
  });

  it('targets at least 11 CSS px at the 1440 × 1000 overview', () => {
    // The lobby Canvas occupies 58dvh; CameraRig fits width/22 or height/16.
    const zoom = Math.min(1440 / 22, 580 / 16);
    const verticalProjection = Math.hypot(13, 17) / Math.hypot(13, 15, 17);
    const size = MONITOR_TEXTURE.overviewFont / MONITOR_TEXTURE.height * MONITOR_FACE.height * zoom * verticalProjection;
    expect(size).toBeGreaterThanOrEqual(11);
    expect(MONITOR_FACE.width + 0.1 + Math.abs(MONITOR_FACE.x) * 2).toBeLessThanOrEqual(2.25);
  });
});
