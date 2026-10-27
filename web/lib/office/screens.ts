/**
 * Desk screen sharing: a person sits at an open desk and its monitor shows their screen to people standing
 * nearby. View only: a shared screen is human-to-human, never agent input, an approval or a record (AGENTS.md §8).
 */
import { WORKSTATIONS } from './layout';
import { workstationLabel } from './handoffs';
import { DESKS } from './targets/desk';
import { OFFICE_ANCHORS } from './state';

export const SCREEN_ENDPOINT = '/__screen';
/** Snapshots per second and their size: readable, not smooth. */
export const SCREEN_INTERVAL_MS = 500;
export const SCREEN_MAX_WIDTH = 1280;
export const SCREEN_QUALITY = 0.6;
/** You see a desk's screen within this many metres (in Play), or while its watch overlay is open. */
export const SCREEN_WATCH_RADIUS = 4;

/** Workstations no agent or business desk uses: anyone may sit at one, one person each. */
export const OPEN_SEATS: readonly number[] = WORKSTATIONS.flatMap(({ center }, index) =>
  workstationLabel(index) === 'Open seat' && !DESKS.some(room => OFFICE_ANCHORS[room].center[0] === center[0] && OFFICE_ANCHORS[room].center[1] === center[1])
    ? [index] : []);
export const isOpenSeat = (desk: unknown): desk is number => typeof desk === 'number' && OPEN_SEATS.includes(desk);

export interface ScreenSeat { desk: number; viewerId: string; name: string }

/** Validated seats message from the relay; anything malformed is dropped. */
export function parseSeats(raw: unknown): ScreenSeat[] | null {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'seats') return null;
  const seats = (raw as { seats?: unknown }).seats;
  if (!Array.isArray(seats)) return null;
  return seats.flatMap(seat => {
    const row = seat as Record<string, unknown> | null;
    return row && isOpenSeat(row.desk) && typeof row.viewerId === 'string' && typeof row.name === 'string'
      ? [{ desk: row.desk, viewerId: row.viewerId, name: row.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24) }] : [];
  });
}

/** What the Play target and the 3D monitors read; the share hook (app/office/useScreenShare) writes it. */
export interface ScreenState {
  readonly enabled: boolean;
  readonly selfId: string;
  readonly seats: readonly ScreenSeat[];
  /** Desks whose live image this viewer currently receives. */
  readonly frames: Readonly<Record<number, number>>;
}
export type ScreenIntent = { kind: 'sit'; desk: number } | { kind: 'stand' } | { kind: 'watch'; desk: number };

function createScreenStore() {
  let state: ScreenState = { enabled: false, selfId: '', seats: [], frames: {} };
  const listeners = new Set<() => void>();
  let intent: ((next: ScreenIntent) => void) | null = null;
  const images = new Map<number, ImageBitmap>();
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: Partial<ScreenState>) { state = { ...state, ...next }; listeners.forEach(listener => listener()); },
    /** The latest image for a desk; `frames[desk]` changes whenever it does. */
    image: (desk: number) => images.get(desk),
    putImage(desk: number, image: ImageBitmap | null) {
      images.get(desk)?.close();
      if (image) images.set(desk, image); else images.delete(desk);
      const frames = { ...state.frames };
      if (image) frames[desk] = (frames[desk] ?? 0) + 1; else delete frames[desk];
      this.set({ frames });
    },
    onIntent(handler: ((next: ScreenIntent) => void) | null) { intent = handler; },
    intend(next: ScreenIntent) { intent?.(next); },
  };
}
export const screenStore = createScreenStore();
export const seatAt = (state: ScreenState, desk: number) => state.seats.find(seat => seat.desk === desk);
export const mySeat = (state: ScreenState) => state.seats.find(seat => seat.viewerId === state.selfId);
