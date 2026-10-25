import { BUILDING, LOBBY_BOARD_MOUNT, WINDOWS, WALL_HEIGHT, WALL_THICKNESS, type Rect, type WindowSpec } from '../layout';
import { AUDIT_WALL } from './auditWall';
import { WHITEBOARD, WHITEBOARD_INTERACTION } from './whiteboard';

/** Leave room between the panel frame and existing wall fixtures. */
const CLEARANCE = 0.3;
type BoardWall = 'north' | 'east' | 'west';
interface OccupiedSpan { wall: BoardWall; at: number; width: number }
const WALL_MOUNTS: readonly OccupiedSpan[] = [
  { wall: 'north', at: WHITEBOARD_INTERACTION.position[0], width: WHITEBOARD.width },
  { wall: 'north', at: LOBBY_BOARD_MOUNT.x, width: LOBBY_BOARD_MOUNT.width },
  { wall: 'west', at: AUDIT_WALL.z, width: AUDIT_WALL.width },
];

export function chooseTicketBoardMount(building: Rect, windows: readonly WindowSpec[], mounts = WALL_MOUNTS) {
  const gaps = (wall: BoardWall) => {
    const left = (wall === 'north' ? building.minX : building.minZ) + WALL_THICKNESS / 2 + CLEARANCE;
    const right = (wall === 'north' ? building.maxX : building.maxZ) - WALL_THICKNESS / 2 - CLEARANCE;
    const occupied = [...windows, ...mounts].filter(span => span.wall === wall)
      .map(span => [span.at - span.width / 2 - CLEARANCE, span.at + span.width / 2 + CLEARANCE] as const)
      .sort((a, b) => a[0] - b[0]);
    const free: { wall: BoardWall; lo: number; hi: number }[] = [];
    let start = left;
    for (const [lo, hi] of occupied) {
      if (lo > start && start < right) free.push({ wall, lo: start, hi: Math.min(lo, right) });
      start = Math.max(start, hi);
    }
    if (start < right) free.push({ wall, lo: start, hi: right });
    return free;
  };
  // Prefer north; use the widest side-wall gap only when neither north size fits.
  for (const free of [gaps('north'), [...gaps('east'), ...gaps('west')]]) {
    for (const nominalWidth of [5, 4]) {
      const center = ({ lo, hi }: { lo: number; hi: number }) => Math.max(lo + nominalWidth / 2, Math.min(0, hi - nominalWidth / 2));
      const gap = free.filter(({ lo, hi }) => hi - lo >= nominalWidth)
        .sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo) || Math.abs(center(a)) - Math.abs(center(b)) || center(a) - center(b))[0];
      if (!gap) continue;
      const bottom = 0.9, depth = 0.12;
      const scale = Math.min(1, (WALL_HEIGHT - 0.1 - bottom) / 2.2);
      const width = nominalWidth * scale, height = 2.2 * scale;
      const at = Math.max(gap.lo + width / 2, Math.min(0, gap.hi - width / 2));
      const inset = WALL_THICKNESS / 2 + depth / 2;
      return {
        wall: gap.wall,
        rotationY: gap.wall === 'north' ? 0 : gap.wall === 'west' ? Math.PI / 2 : -Math.PI / 2,
        x: gap.wall === 'north' ? at : gap.wall === 'west' ? building.minX + inset : building.maxX - inset,
        z: gap.wall === 'north' ? building.minZ + inset : at,
        width, height, bottom, depth,
        faceWidth: (nominalWidth - 0.14) * scale, faceHeight: 2.06 * scale,
      };
    }
  }
  throw new RangeError('North, east and west walls need a free span of at least 4 m for tickets');
}

export const TICKET_BOARD = chooseTicketBoardMount(BUILDING, WINDOWS);
export function ticketBoardGeometry(board: ReturnType<typeof chooseTicketBoardMount>) {
  const north = board.wall === 'north';
  const halfX = (north ? board.width : board.depth) / 2;
  const halfZ = (north ? board.depth : board.width) / 2;
  return {
    position: [board.x + Math.sin(board.rotationY) * board.depth / 2, board.z + Math.cos(board.rotationY) * board.depth / 2] as const,
    box: { minX: board.x - halfX, maxX: board.x + halfX, minZ: board.z - halfZ, maxZ: board.z + halfZ },
  };
}
const geometry = ticketBoardGeometry(TICKET_BOARD);
export const TICKET_BOARD_POSITION = geometry.position;
export const TICKET_BOARD_BOX = geometry.box;
/** One 8 MiB RGBA backing store. Smallest text stays ~7 CSS px at 6 m / 1000px / 75° FOV. */
export const TICKET_BOARD_TEXTURE = { width: 2048, height: 1024, minFont: 36 } as const;
