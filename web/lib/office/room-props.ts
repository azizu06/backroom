/** Additional room dressing. Local +z is the shelf front; every placement uses a solid interior wall. */
import { SPACES, WALL_THICKNESS, roomPoint, type SpaceId, type Rect } from './layout';
import { PALETTE, ROLES } from './palette';
import type { DetailPiece } from './props/roomDetail';

const INSET = WALL_THICKNESS / 2 + 0.2;
interface PropSite { room: SpaceId; x: number; z: number; turn: number; board: boolean }
const east = (room: 'collections' | 'payables' | 'vendor_onboarding' | 'dana' | 'treasury', dz: number): PropSite => ({
  room, x: SPACES[room].rect.maxX - INSET, z: roomPoint(room, 0, dz)[1], turn: -Math.PI / 2, board: room !== 'dana',
});
export const ROOM_PROP_SITES: readonly PropSite[] = [
  { room: 'lobby', x: roomPoint('lobby', -1.75, 0)[0], z: SPACES.lobby.rect.minZ + INSET, turn: 0, board: false },
  east('collections', 2.1),
  east('payables', 0.8),
  east('vendor_onboarding', 0.5),
  east('dana', -1),
  east('treasury', -1),
  { room: 'server_room', x: SPACES.server_room.rect.minX + 1.05, z: SPACES.server_room.rect.maxZ - INSET, turn: Math.PI, board: true },
  { room: 'corridor', x: SPACES.payables.rect.maxX - 0.85, z: SPACES.corridor.rect.minZ + INSET, turn: 0, board: false },
];

const WIDTH = 1.35, DEPTH = 0.34, HEIGHT = 0.94;
const ACCENTS = [PALETTE.aqua, PALETTE.lavender, PALETTE.mint, PALETTE.butter, PALETTE.blush];
function vignette(site: PropSite, index: number): DetailPiece[] {
  const pieces: DetailPiece[] = [];
  const cos = Math.cos(site.turn), sin = Math.sin(site.turn);
  const part = (shape: DetailPiece['shape'], x: number, y: number, z: number, size: DetailPiece['size'], color: string) => {
    pieces.push({ shape, at: [site.x + x * cos + z * sin, y, site.z - x * sin + z * cos], size, color, rotation: [0, site.turn, 0] });
  };
  const box = (x: number, y: number, z: number, size: DetailPiece['size'], color: string) => part('box', x, y, z, size, color);
  const cylinder = (x: number, y: number, z: number, size: DetailPiece['size'], color: string) => part('cylinder', x, y, z, size, color);
  const accent = ACCENTS[index % ACCENTS.length]!;
  // Open bookcase: solid footprint is registered below; small objects remain on its top.
  box(0, HEIGHT / 2, -0.15, [WIDTH, HEIGHT, 0.04], ROLES.partition);
  for (const side of [-1, 1]) box(side * (WIDTH / 2 - 0.025), HEIGHT / 2, 0, [0.05, HEIGHT, DEPTH], ROLES.desk);
  for (const y of [0.05, 0.48, HEIGHT - 0.025]) box(0, y, 0, [WIDTH, 0.05, DEPTH], ROLES.desk);
  for (const base of [0.075, 0.505]) for (let i = 0; i < 7; i++) {
    const x = -0.53 + i * 0.15, height = 0.24 + (i % 3) * 0.035;
    box(x, base + height / 2, 0, [0.1, height, 0.24], ACCENTS[(index + i) % ACCENTS.length]!);
    box(x, base + 0.07, 0.123, [0.06, 0.025, 0.006], PALETTE.cream);
  }
  // Potted plant, coffee mug with open dark top and a C-shaped handle, and a small desk lamp.
  cylinder(-0.44, 1.02, 0, [0.19, 0.16, 0.19], accent);
  cylinder(-0.44, 1.105, 0, [0.15, 0.01, 0.15], ROLES.shadow);
  cylinder(-0.44, 1.22, 0, [0.025, 0.24, 0.025], ROLES.plant);
  box(-0.49, 1.22, 0, [0.12, 0.07, 0.12], PALETTE.mint);
  box(-0.39, 1.3, 0, [0.13, 0.09, 0.13], PALETTE.mint);
  cylinder(0, 1.02, 0, [0.14, 0.16, 0.14], accent);
  cylinder(0, 1.103, 0, [0.105, 0.006, 0.105], ROLES.shadow);
  for (const y of [0.97, 1.07]) box(0.095, y, 0, [0.07, 0.025, 0.025], accent);
  box(0.13, 1.02, 0, [0.025, 0.1, 0.025], accent);
  cylinder(0.43, 0.96, 0, [0.22, 0.04, 0.22], ROLES.frame);
  cylinder(0.43, 1.16, 0, [0.025, 0.38, 0.025], ROLES.frame);
  cylinder(0.43, 1.37, 0, [0.26, 0.16, 0.26], PALETTE.butter);
  cylinder(0.43, 1.285, 0, [0.22, 0.01, 0.22], ROLES.lampLight);
  // Framed corkboard or abstract landscape, above the lamp and below the ceiling.
  box(0, 2.02, -0.17, [1.15, 0.78, 0.04], ROLES.frame);
  box(0, 2.02, -0.143, [1.05, 0.68, 0.012], site.board ? PALETTE.peach : PALETTE.cream);
  if (site.board) {
    for (const side of [-1, 1]) {
      box(side * 0.26, 2.02, -0.13, [0.35, 0.43, 0.01], side < 0 ? PALETTE.butter : PALETTE.mint);
      box(side * 0.26, 2.2, -0.12, [0.035, 0.035, 0.01], PALETTE.coral);
      for (let row = 0; row < 3; row++) box(side * 0.26, 2.1 - row * 0.08, -0.12, [0.23, 0.018, 0.01], ROLES.text);
    }
  } else {
    box(-0.13, 1.92, -0.13, [0.72, 0.27, 0.01], accent);
    box(0.24, 1.86, -0.12, [0.43, 0.18, 0.01], PALETTE.mint);
    box(0.24, 2.19, -0.13, [0.16, 0.16, 0.01], PALETTE.butter);
  }
  return pieces;
}

export const ROOM_PROP_GROUPS = ROOM_PROP_SITES.map((site, index) => ({ room: site.room, pieces: vignette(site, index) }));
/** The corridor and server room are always furnished; the other rooms only while they are visible. */
export const roomPropsVisible = (room: SpaceId, rooms: readonly SpaceId[]) => room === 'corridor' || room === 'server_room' || rooms.includes(room);
/** Only the large floor bookcases collide; tabletop objects and wall frames add no blockers. Precomputed once. */
const SITE_COLLIDERS: readonly { room: SpaceId; box: Rect }[] = ROOM_PROP_SITES.map(site => {
  const cos = Math.abs(Math.cos(site.turn)), sin = Math.abs(Math.sin(site.turn));
  const halfX = (WIDTH * cos + DEPTH * sin) / 2, halfZ = (WIDTH * sin + DEPTH * cos) / 2;
  return { room: site.room, box: { minX: site.x - halfX, maxX: site.x + halfX, minZ: site.z - halfZ, maxZ: site.z + halfZ } };
});
export function roomPropColliders(rooms: readonly SpaceId[]): Rect[] {
  return SITE_COLLIDERS.filter(({ room }) => roomPropsVisible(room, rooms)).map(({ box }) => box);
}
