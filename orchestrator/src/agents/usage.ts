import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpecialistModel } from './contracts';

/** One shared ledger per credential owner (spike §"Will one teammate's $50 last?").
 * Each teammate's key is its own envelope; never pool owners or rotate keys past a stop.
 * Amounts are SDK list-price estimates; the Console remains billing authority. */
export const LEDGER_LIMITS = { warnUsd: 25, ordinaryStopUsd: 35, hardStopUsd: 40 } as const;
export const ACTIVATION_BUDGET_USD: Readonly<Record<SpecialistModel, number>> = { 'claude-haiku-5-5': 0.02, 'claude-sonnet-5-5': 0.08 };
export const CASE_BUDGET_USD = { development: 0.30, demo: 0.50 } as const;
export type RunMode = keyof typeof CASE_BUDGET_USD;

export interface Reservation { id: string; ownerId: string; amountUsd: number; mode: RunMode }
export interface OwnerUsage { spentUsd: number; reservedUsd: number; unknownSettlements: number; warn: boolean }
interface LedgerData { owners: Record<string, { spentUsd: number; unknownSettlements: number; reservations: Record<string, Reservation> }> }

export class BudgetError extends Error {}
export interface UsageLedger {
  /** Ordinary runs stop at $35 committed; demo runs may use the reserve up to the $40 hard stop. */
  reserve(ownerId: string, amountUsd: number, mode: RunMode): Promise<Reservation>;
  /** Unknown, absent or zeroed accounting is charged at the full reservation, never as free. */
  settle(reservation: Reservation, actualUsd: number | undefined): Promise<OwnerUsage>;
  /** Drop a reservation whose activation never reached the model. */
  release(reservation: Reservation): Promise<OwnerUsage>;
  usage(ownerId: string): Promise<OwnerUsage>;
}

function view(data: LedgerData, ownerId: string): OwnerUsage {
  const owner = data.owners[ownerId] ?? { spentUsd: 0, unknownSettlements: 0, reservations: {} };
  return { spentUsd: owner.spentUsd, reservedUsd: Object.values(owner.reservations).reduce((sum, r) => sum + r.amountUsd, 0),
    unknownSettlements: owner.unknownSettlements, warn: owner.spentUsd >= LEDGER_LIMITS.warnUsd };
}
function reserveIn(data: LedgerData, ownerId: string, amountUsd: number, mode: RunMode): Reservation {
  if (!ownerId || !Number.isFinite(amountUsd) || amountUsd <= 0) throw new BudgetError('INVALID_RESERVATION');
  const { spentUsd, reservedUsd } = view(data, ownerId);
  const committed = spentUsd + reservedUsd + amountUsd;
  if (committed > LEDGER_LIMITS.hardStopUsd) throw new BudgetError('BUDGET_HARD_STOP');
  if (mode !== 'demo' && committed > LEDGER_LIMITS.ordinaryStopUsd) throw new BudgetError('BUDGET_ORDINARY_STOP');
  const owner = data.owners[ownerId] ??= { spentUsd: 0, unknownSettlements: 0, reservations: {} };
  const reservation = { id: randomUUID(), ownerId, amountUsd, mode };
  owner.reservations[reservation.id] = reservation;
  return reservation;
}
function settleIn(data: LedgerData, reservation: Reservation, actualUsd: number | undefined): OwnerUsage {
  const owner = data.owners[reservation.ownerId];
  if (!owner?.reservations[reservation.id]) throw new BudgetError('UNKNOWN_RESERVATION');
  delete owner.reservations[reservation.id];
  const known = actualUsd !== undefined && Number.isFinite(actualUsd) && actualUsd > 0;
  owner.spentUsd += known ? actualUsd : reservation.amountUsd;
  if (!known) owner.unknownSettlements += 1;
  return view(data, reservation.ownerId);
}

function releaseIn(data: LedgerData, reservation: Reservation): OwnerUsage {
  const owner = data.owners[reservation.ownerId];
  if (!owner?.reservations[reservation.id]) throw new BudgetError('UNKNOWN_RESERVATION');
  delete owner.reservations[reservation.id];
  return view(data, reservation.ownerId);
}

export class MemoryUsageLedger implements UsageLedger {
  private readonly data: LedgerData = { owners: {} };
  async reserve(ownerId: string, amountUsd: number, mode: RunMode) { return reserveIn(this.data, ownerId, amountUsd, mode); }
  async settle(reservation: Reservation, actualUsd: number | undefined) { return settleIn(this.data, reservation, actualUsd); }
  async release(reservation: Reservation) { return releaseIn(this.data, reservation); }
  async usage(ownerId: string) { return view(this.data, ownerId); }
}

/** Cross-process ledger on one host: O_EXCL lock file, read-modify-write, atomic rename.
 * Default path is gitignored (`.env.*`). A crashed holder's lock expires after 10 s. */
export class FileUsageLedger implements UsageLedger {
  constructor(private readonly path = '.env.agents/usage-ledger.json') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
  private async locked<T>(fn: (data: LedgerData) => T): Promise<T> {
    const lock = `${this.path}.lock`;
    for (let attempt = 0; ; attempt++) {
      try { closeSync(openSync(lock, 'wx', 0o600)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true }); } catch { /* raced */ }
        if (attempt > 200) throw new BudgetError('LEDGER_LOCKED');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try {
      let data: LedgerData = { owners: {} };
      try { data = JSON.parse(readFileSync(this.path, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new BudgetError('LEDGER_UNREADABLE'); }
      const result = fn(data);
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      renameSync(temporary, this.path);
      return result;
    } finally { rmSync(lock, { force: true }); }
  }
  reserve(ownerId: string, amountUsd: number, mode: RunMode) { return this.locked(d => reserveIn(d, ownerId, amountUsd, mode)); }
  settle(reservation: Reservation, actualUsd: number | undefined) { return this.locked(d => settleIn(d, reservation, actualUsd)); }
  release(reservation: Reservation) { return this.locked(d => releaseIn(d, reservation)); }
  usage(ownerId: string) { return this.locked(d => view(d, ownerId)); }
}
