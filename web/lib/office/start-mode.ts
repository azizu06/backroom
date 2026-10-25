/** Pure start-view decision for /office. Visual only: it picks a camera, never business state. */
export type StartView = 'play' | 'overview';
export const START_VIEW_KEY = 'office.start';
/** Phones and touch-first devices: they start in the overview (touch Play stays one tap away). */
export const COMPACT_QUERY = '(max-width: 760px), (pointer: coarse)';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function isStartView(value: unknown): value is StartView {
  return value === 'play' || value === 'overview';
}

/**
 * Which view /office opens in. Replay and story mode keep their own start (the overview);
 * then `?view=` wins, then phones start in the overview, then the viewer's last choice; Play by default.
 */
export function startView({ search, stored, compact }: { search: string | URLSearchParams; stored: string | null | undefined; compact: boolean }): StartView {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  if (params.has('replay') || params.get('demo') === 'story') return 'overview';
  const requested = params.get('view');
  if (isStartView(requested)) return requested;
  if (compact) return 'overview';
  return isStartView(stored) ? stored : 'play';
}

function defaultStorage(): StorageLike | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}
export function readStartView(storage?: StorageLike): StartView | null {
  try {
    const value = (storage ?? defaultStorage())?.getItem(START_VIEW_KEY);
    return isStartView(value) ? value : null;
  } catch { return null; }
}
export function saveStartView(view: StartView, storage?: StorageLike) {
  try { (storage ?? defaultStorage())?.setItem(START_VIEW_KEY, view); } catch { /* Storage may be unavailable. */ }
}
