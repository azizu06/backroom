/** Types retained for the opt-in desk kit; partition art and room rugs are retired. */
import type { FurniturePiece } from '../furniture';
import type { AnchorId } from '../state';

export interface DetailPiece extends FurniturePiece { shape: 'box' | 'cylinder' }
export interface RoomDetailItem {
  id: string;
  room: AnchorId;
  kind: 'rug' | 'art' | 'plant' | 'mug' | 'papers' | 'books' | 'lamp';
  pieces: readonly DetailPiece[];
}

export const ROOM_DETAILS: readonly RoomDetailItem[] = [];
export function roomDetailsInRooms(_rooms: readonly AnchorId[]): readonly RoomDetailItem[] { return ROOM_DETAILS; }
