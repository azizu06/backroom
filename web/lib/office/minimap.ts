import { OFFICE_ANCHORS, isAnchorId, type AnchorId, type FloorPosition, type OfficeSnapshot } from './state';
import { FLOOR, PAYLINK_KIOSK, SERVER_ROOM, TREASURY_DOOR, type Vec2 } from './play';

export interface MapPoint { readonly x: number; readonly y: number }
export interface MapTransform { readonly scale: number; readonly offsetX: number; readonly offsetY: number; readonly size: number }
export type MapItem =
  | { readonly kind: 'room'; readonly id: AnchorId; readonly name: string; readonly position: FloorPosition }
  | { readonly kind: 'door' | 'server' | 'kiosk'; readonly name: string; readonly position: FloorPosition }
  | { readonly kind: 'agent'; readonly id: string; readonly name: string; readonly position: FloorPosition; readonly color: string; readonly alert: boolean };

export function mapTransform(size: number, padding = 8): MapTransform {
  const scale = (size - padding * 2) / Math.max(FLOOR.maxX - FLOOR.minX, FLOOR.maxZ - FLOOR.minZ);
  return { scale, offsetX: (size - (FLOOR.maxX - FLOOR.minX) * scale) / 2, offsetY: (size - (FLOOR.maxZ - FLOOR.minZ) * scale) / 2, size };
}
/** World x increases right; world z increases down, matching the overhead camera view. */
export function worldToMap([x, z]: Vec2, transform: MapTransform): MapPoint {
  return { x: transform.offsetX + (x - FLOOR.minX) * transform.scale, y: transform.offsetY + (z - FLOOR.minZ) * transform.scale };
}
/** SVG arrow points up at yaw zero; positive yaw turns toward screen left. */
export function headingRotation(yaw: number): number { return -yaw * 180 / Math.PI; }

export function minimapItems(snapshot: OfficeSnapshot, rooms: readonly AnchorId[]): MapItem[] {
  const items: MapItem[] = [];
  const denied = new Set(snapshot.denials.map(row => row.agentId));
  for (const id of rooms) {
    if (!isAnchorId(id)) continue;
    const anchor = OFFICE_ANCHORS[id];
    items.push({ kind: 'room', id, name: anchor.name, position: anchor.center });
  }
  const has = (id: AnchorId) => rooms.includes(id);
  if (has('treasury')) items.push({ kind: 'door', name: 'Treasury door', position: TREASURY_DOOR });
  items.push({ kind: 'server', name: 'Server room', position: SERVER_ROOM.position });
  if (has('lobby')) items.push({ kind: 'kiosk', name: 'Pay kiosk', position: PAYLINK_KIOSK });
  for (const agent of snapshot.agents) items.push({
    kind: 'agent', id: agent.id, name: agent.name, position: agent.pos, color: OFFICE_ANCHORS[agent.targetAnchor]?.color ?? '#d0d6c6',
    alert: !!agent.escalationId || denied.has(agent.id) || /escalat|deni/i.test(agent.state),
  });
  return items;
}

export function roomAt(position: Vec2, rooms: readonly AnchorId[]): string | undefined {
  let nearest: { name: string; distance: number } | undefined;
  for (const id of rooms) {
    if (!isAnchorId(id)) continue;
    const [x, z] = OFFICE_ANCHORS[id].center;
    const distance = Math.hypot(position[0] - x, position[1] - z);
    if (distance < 3 && (!nearest || distance < nearest.distance)) nearest = { name: OFFICE_ANCHORS[id].name, distance };
  }
  return nearest?.name;
}
