import { describe, expect, it } from 'vitest';
import { deskPieces, deskScreenPiece, PLANT_SPOTS } from './furniture';
import { MONITOR_FACE } from './props/monitors';
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

  it('rotates Dana’s chair and paper around the anchor and turns her screen back to the room', () => {
    const pieces = deskPieces('dana');
    expect(pieces[5]!.at).toEqual([-0.65, 0.95, 3.3]);
    expect(pieces[5]!.rotation![1]).toBeCloseTo(Math.PI - 0.12);
    expect(pieces[7]!.at[2]).toBeCloseTo(4.54);
    const screen = deskScreenPiece('dana');
    expect(screen.at[0]).toBeCloseTo(OFFICE_ANCHORS.dana.center[0] - MONITOR_FACE.x);
    expect(screen.at[2]).toBeCloseTo(OFFICE_ANCHORS.dana.center[1] - MONITOR_FACE.z + 0.05);
    expect(screen.rotation).toEqual([0, 0, 0]);
  });

  it.each(DESKS)('keeps %s monitor face in front of its casing', room => {
    const casing = deskPieces(room)[3]!;
    const screen = deskScreenPiece(room);
    expect(screen.at[0]).toBe(casing.at[0]);
    expect(screen.at[1]).toBe(casing.at[1]);
    expect(screen.at[2] - casing.at[2]).toBeCloseTo(0.05);
    expect(casing.size).toEqual([MONITOR_FACE.width + 0.1, MONITOR_FACE.height + 0.1, 0.08]);
    expect(screen.size).toEqual([MONITOR_FACE.width + 0.01, MONITOR_FACE.height + 0.01, 0.015]);
    expect(screen.color).toBe(OFFICE_ANCHORS[room].color);
  });

  it('retains the three fixed plant footprints', () => {
    expect(PLANT_SPOTS).toEqual([[-7.1, -4.6], [7.1, -4.6], [1.7, 4.5]]);
  });
});
