import { describe, expect, it } from 'vitest';
import { deskPieces, deskScreenPiece, PLANT_SPOTS } from './furniture';
import { OFFICE_ANCHORS } from './state';
import { DESKS, DESK_SIZE } from './targets/desk';

describe('static office furniture', () => {
  it.each(DESKS)('keeps %s furniture at the existing anchor and footprint', room => {
    const pieces = deskPieces(room);
    expect(pieces).toHaveLength(8);
    const top = pieces[0]!;
    expect(top.at).toEqual([OFFICE_ANCHORS[room].center[0], 0.83, OFFICE_ANCHORS[room].center[1]]);
    expect(top.size).toEqual([DESK_SIZE.width, 0.16, DESK_SIZE.depth]);
    expect(pieces.slice(-2).map(piece => piece.color)).toEqual([OFFICE_ANCHORS[room].color, OFFICE_ANCHORS[room].color]);
    expect(deskPieces(room)).toEqual(pieces);
  });

  it('rotates Dana’s chair, paper and screen together around the anchor', () => {
    const pieces = deskPieces('dana');
    expect(pieces[5]!.at).toEqual([-0.65, 0.95, 3.3]);
    expect(pieces[5]!.rotation![1]).toBeCloseTo(Math.PI - 0.12);
    expect(pieces[7]!.at[2]).toBeCloseTo(4.54);
    const screen = deskScreenPiece('dana');
    expect(screen.at[0]).toBe(0.35);
    expect(screen.at[2]).toBeCloseTo(3.58);
    expect(screen.rotation).toEqual([0, Math.PI, 0]);
  });

  it.each(DESKS)('keeps %s monitor face in front of its casing', room => {
    const casing = deskPieces(room)[3]!;
    const screen = deskScreenPiece(room);
    const flip = room === 'dana' ? -1 : 1;
    expect(screen.at[0]).toBe(casing.at[0]);
    expect(screen.at[1]).toBe(casing.at[1]);
    expect((screen.at[2] - casing.at[2]) * flip).toBeCloseTo(0.05);
    expect(screen.size).toEqual([0.67, 0.37, 0.015]);
    expect(screen.color).toBe(OFFICE_ANCHORS[room].color);
  });

  it('retains the three fixed plant footprints', () => {
    expect(PLANT_SPOTS).toEqual([[-7.1, -4.6], [7.1, -4.6], [1.7, 4.5]]);
  });
});
