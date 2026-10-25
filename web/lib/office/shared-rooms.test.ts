import { describe, expect, it, vi } from 'vitest';
import { drawMeetingAgenda, drawMeetingWhiteboard } from '../../app/office/mounts/SharedRoomDisplays';
import { SHARED_ROOM_COLLIDERS, SHARED_ROOM_PIECES } from './shared-rooms';
import { OUTDOOR, PALETTE, ROLES } from './palette';
import { insideAny } from './play';

function drawingContext() {
  return {
    fillRect: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  };
}

describe('shared room details', () => {
  it('shows Backroom branding and a readable three-item agenda', () => {
    const ctx = drawingContext();
    drawMeetingAgenda(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual([
      'Backroom', 'TEAM SYNC', '01  Review the inbox', '02  Resolve approvals', '03  Next steps',
    ]);
  });

  it('draws three labeled whiteboard boxes connected by two arrows', () => {
    const ctx = drawingContext();
    drawMeetingWhiteboard(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(3);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenCalledTimes(6);
    expect(ctx.fillText.mock.calls.slice(0, 3).map(call => call[0])).toEqual(['Inbox', 'Review', 'Done']);
  });

  it('uses palette tokens and positive, finite geometry', () => {
    const colors = new Set<string>([...Object.values(PALETTE), ...Object.values(ROLES), ...Object.values(OUTDOOR)]);
    for (const piece of SHARED_ROOM_PIECES) {
      expect(colors.has(piece.color)).toBe(true);
      expect(piece.at.every(Number.isFinite)).toBe(true);
      expect(piece.size.every(n => Number.isFinite(n) && n > 0)).toBe(true);
    }
  });

  it('makes all six meeting chairs, four break chairs and three plant pots solid', () => {
    const seatsAndPots = SHARED_ROOM_PIECES.filter(piece =>
      (piece.at[1] === 0.46 && piece.size[0] === 0.48)
      || (piece.at[1] === 0.47 && piece.size[0] === 0.38)
      || (piece.at[1] === 0.2 && piece.size[0] === 0.42));
    expect(seatsAndPots).toHaveLength(13);
    for (const piece of seatsAndPots) {
      expect(insideAny([piece.at[0], piece.at[2]], SHARED_ROOM_COLLIDERS, 0)).toBe(true);
    }
  });
});
