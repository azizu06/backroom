import { describe, expect, it } from 'vitest';
import { BUILDING, LOBBY_BOARD_MOUNT, WINDOWS, WALL_HEIGHT, WALL_THICKNESS } from '../layout';
import { BASE_FOV } from '../playFeel';
import { WHITEBOARD, WHITEBOARD_INTERACTION } from './whiteboard';
import { chooseTicketBoardMount, ticketBoardGeometry, TICKET_BOARD, TICKET_BOARD_TEXTURE } from './ticketBoard';

const square = { minX: -12, maxX: 12, minZ: -12, maxZ: 12 };
const scale = Math.min(1, (WALL_HEIGHT - 1) / 2.2);

describe('ticket board geometry', () => {
  it('clears current north-wall windows and mounted boards by at least 0.3 m', () => {
    const board = chooseTicketBoardMount(BUILDING, WINDOWS);
    expect(board.wall).toBe('north');
    expect(board.width).toBeCloseTo(5 * scale);
    const occupied = [
      ...WINDOWS.filter(window => window.wall === 'north'),
      { at: WHITEBOARD_INTERACTION.position[0], width: WHITEBOARD.width },
      { at: LOBBY_BOARD_MOUNT.x, width: LOBBY_BOARD_MOUNT.width },
    ];
    for (const span of occupied) {
      const clearance = Math.max(span.at - span.width / 2 - (board.x + board.width / 2), board.x - board.width / 2 - (span.at + span.width / 2));
      expect(clearance).toBeGreaterThanOrEqual(0.3 - 1e-10);
    }
    expect(board.z - board.depth / 2).toBeCloseTo(BUILDING.minZ + WALL_THICKNESS / 2);
    expect(board.bottom).toBe(0.9);
  });
  it('centres at zero when the square wall has a central six-metre gap', () => {
    const windows = [-7.5, 7.5].map(at => ({ wall: 'north', at, width: 9, space: 'payables' as const }));
    const board = chooseTicketBoardMount(square, windows, []);
    expect(board).toMatchObject({ wall: 'north', x: 0, z: -11.86 });
    expect(board.width).toBeCloseTo(5 * scale);
  });
  it('uses the widest gap even when a narrower fitting gap is nearer zero', () => {
    const board = chooseTicketBoardMount(square, [], [{ wall: 'north', at: -3, width: 1 }]);
    expect(board.x - board.width / 2).toBeCloseTo(-2.2);
  });
  it('breaks equal-width gap ties by proximity to zero', () => {
    const board = chooseTicketBoardMount({ ...square, minX: -9, maxX: 16 }, [], [{ wall: 'north', at: 3.5, width: 1 }]);
    expect(board.x).toBe(0);
  });
  it('shrinks to four metres only when five cannot fit on the north wall', () => {
    const board = chooseTicketBoardMount({ ...square, minX: -2.4, maxX: 2.4 }, [], []);
    expect(board).toMatchObject({ wall: 'north', x: 0 });
    expect(board.width).toBeCloseTo(4 * scale);
  });
  it.each(['east', 'west'] as const)('records and faces inward on the widest free %s fallback', wall => {
    const otherWall = wall === 'east' ? 'west' : 'east';
    const building = { ...square, minX: -2, maxX: 2 };
    const board = chooseTicketBoardMount(building, [{ wall: otherWall, at: 0, width: 12, space: 'payables' }], []);
    expect(board).toMatchObject({ wall, z: 0 });
    expect(board.width).toBeCloseTo(5 * scale);
    const { position, box } = ticketBoardGeometry(board);
    expect(box.maxX - box.minX).toBeCloseTo(board.depth);
    expect(box.maxZ - box.minZ).toBeCloseTo(board.width);
    expect(position[0]).toBeCloseTo(wall === 'east' ? box.minX : box.maxX);
    expect(wall === 'east' ? box.maxX : box.minX).toBeCloseTo(wall === 'east' ? building.maxX - WALL_THICKNESS / 2 : building.minX + WALL_THICKNESS / 2);
  });
  it('rejects rooms with no fitting north, east or west span', () => {
    expect(() => chooseTicketBoardMount({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, [], [])).toThrow(RangeError);
  });
  it('keeps the top 0.1 m below the ceiling while preserving panel and face aspect ratios', () => {
    for (const nominalWidth of [5, 4]) {
      const board = chooseTicketBoardMount({ ...square, minX: -nominalWidth / 2 - 0.4, maxX: nominalWidth / 2 + 0.4 }, [], []);
      expect(board.bottom + board.height).toBeLessThanOrEqual(WALL_HEIGHT - 0.1);
      expect(board.width / board.height).toBeCloseTo(nominalWidth / 2.2);
      expect(board.faceWidth / board.faceHeight).toBeCloseTo((nominalWidth - 0.14) / 2.06);
    }
  });
  it('uses a 2048-wide canvas with seven-pixel card text at six metres and the Play FOV', () => {
    expect(TICKET_BOARD_TEXTURE.width).toBeGreaterThanOrEqual(2048);
    const worldFont = TICKET_BOARD_TEXTURE.minFont / TICKET_BOARD_TEXTURE.height * TICKET_BOARD.faceHeight;
    const projected = worldFont * 1000 / (2 * 6 * Math.tan(BASE_FOV * Math.PI / 360));
    expect(projected).toBeGreaterThan(6.9);
  });
});
