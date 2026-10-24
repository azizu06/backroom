/**
 * Fixture handoff stream for `/office?handoffs=mock`, so the choreography is demoable before the
 * backend table exists. Never used as a live source: it only emits rows in the adapter's shape.
 */
import type { Handoff, HandoffStatus } from './handoffs';

interface ScriptRow { readonly offset: number; readonly from: string; readonly to: string; readonly item: string; readonly summary: string; readonly status: HandoffStatus; readonly resolve?: { readonly offset: number; readonly status: HandoffStatus } }
/**
 * One cycle of the invoice pipeline (offsets in ms at speed 1). Shows a queue (two intake rows for the
 * extractor), an overlap (collections → auditor alongside intake), a failed check that walks back and
 * is retried, and Dana appearing only for the passkey step.
 */
export const MOCK_HANDOFF_SCRIPT: readonly ScriptRow[] = [
  { offset: 0, from: 'intake', to: 'extractor', item: 'INV-1042', summary: 'Northwind invoice email · PDF attached', status: 'accepted' },
  { offset: 0, from: 'collections', to: 'auditor', item: 'INV-0977', summary: 'Second reminder sent to Ridgeway · log it', status: 'accepted' },
  { offset: 400, from: 'intake', to: 'extractor', item: 'INV-1043', summary: 'Bay Supply invoice · scanned PDF', status: 'accepted' },
  { offset: 5000, from: 'extractor', to: 'vendor_verifier', item: 'INV-1042', summary: 'Remit-to ••4821 does not match vendor master ••7710', status: 'failed' },
  { offset: 5100, from: 'extractor', to: 'vendor_verifier', item: 'INV-1042', summary: 'Re-read page 2 · remit-to ••7710 matches master', status: 'accepted' },
  { offset: 5200, from: 'vendor_verifier', to: 'payables', item: 'INV-1042', summary: 'Vendor verified · W-9 and bank letter on file', status: 'accepted' },
  { offset: 5300, from: 'payables', to: 'human', item: 'INV-1042', summary: 'Pay $4,200 to Northwind · needs Dana’s passkey', status: 'awaiting_passkey', resolve: { offset: 52_000, status: 'accepted' } },
  { offset: 5400, from: 'payables', to: 'reconciler', item: 'PAY-88', summary: 'Payment released · match it to the bank feed', status: 'accepted' },
  { offset: 5500, from: 'reconciler', to: 'auditor', item: 'PAY-88', summary: 'Matched PAY-88 to bank feed line 3 of 112', status: 'accepted' },
];
export const MOCK_CYCLE_MS = 64_000;
const KEEP = 40;

export interface HandoffFeed {
  subscribe(listener: () => void): () => void;
  getRows(): readonly Handoff[];
  start(): void;
  stop(): void;
}

/** Rows of one cycle as they should look at `now` (pure; used by the feed and tests). */
export function mockCycleRows(cycle: number, cycleStart: number, now: number, speed = 1): Handoff[] {
  const rows: Handoff[] = [];
  MOCK_HANDOFF_SCRIPT.forEach((row, i) => {
    const at = cycleStart + row.offset / speed;
    if (at > now) return;
    const resolvedAt = row.resolve && cycleStart + row.resolve.offset / speed;
    const resolved = resolvedAt !== undefined && resolvedAt <= now;
    rows.push({
      id: `mock-${cycle}-${i + 1}`, from: row.from, to: row.to, item: row.item, summary: row.summary, at,
      status: resolved ? row.resolve!.status : row.status, ...(resolved ? { updatedAt: resolvedAt } : {}),
    });
  });
  return rows;
}

/** Emits the script on a loop; each cycle's rows get fresh ids. `now` and timers are injectable for tests. */
export function createMockHandoffFeed({ speed = 1, now = () => Date.now(), lead = 600 }: { speed?: number; now?: () => number; lead?: number } = {}): HandoffFeed {
  const listeners = new Set<() => void>();
  let rows: readonly Handoff[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin = 0;
  const cycleMs = MOCK_CYCLE_MS / speed;
  const times = MOCK_HANDOFF_SCRIPT.flatMap(row => [row.offset, ...(row.resolve ? [row.resolve.offset] : [])]).map(offset => offset / speed).sort((a, b) => a - b);

  function rebuild(at: number) {
    const cycle = Math.floor((at - origin) / cycleMs);
    const next: Handoff[] = [];
    for (let c = Math.max(0, cycle - 1); c <= cycle; c++) next.push(...mockCycleRows(c, origin + c * cycleMs, at, speed));
    const trimmed = next.slice(-KEEP);
    const changed = trimmed.length !== rows.length || trimmed.some((row, i) => row.id !== rows[i]!.id || row.status !== rows[i]!.status);
    if (changed) { rows = trimmed; listeners.forEach(listener => listener()); }
  }
  function schedule() {
    const at = now();
    const inCycle = (at - origin) % cycleMs;
    const upcoming = times.find(time => time > inCycle);
    const wait = (upcoming ?? cycleMs) - inCycle;
    timer = setTimeout(() => { rebuild(now()); schedule(); }, Math.max(16, wait + 1));
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRows: () => rows,
    start() {
      if (timer !== undefined) return;
      origin = now() + lead;
      rebuild(now());
      schedule();
    },
    stop() { clearTimeout(timer); timer = undefined; },
  };
}
