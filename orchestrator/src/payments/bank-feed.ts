import type { NessieClient, Transaction } from '@backroom/nessie';

export interface BankTxnRow {
  nessieId: string;
  amountCents: number;
  memo: string;
  postedAt: string;
  accountId: string;
}
export interface BankTxnSink { recordBankTxn(row: BankTxnRow): Promise<void> }

/** Fixed key order keeps retries identical regardless of the caller's property order. */
export function bankTxnPayload(row: BankTxnRow): string {
  const { nessieId, amountCents, memo, postedAt, accountId } = row;
  return JSON.stringify({ nessieId, amountCents, memo, postedAt, accountId });
}

export function toBankTxnRow(accountId: string, txn: Transaction): BankTxnRow | undefined {
  // Only completed deposits are mirrored because rows are immutable.
  if (txn.status !== 'completed') return undefined;
  const amountCents = Math.round(txn.amount * 100);
  // Round-trip dollars to allow binary floating-point noise, never fractional cents.
  if (!Number.isFinite(txn.amount) || !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      amountCents / 100 !== txn.amount || !txn._id || txn._id.length > 200 || !txn.description) return undefined;
  return { nessieId: txn._id, amountCents, memo: txn.description,
    postedAt: txn.transaction_date, accountId };
}

export async function mirrorBankFeed(bank: Pick<NessieClient, 'listDeposits'>, sink: BankTxnSink, accountId: string): Promise<{ recorded: number; skipped: number; failed: number }> {
  const deposits = await bank.listDeposits(accountId);
  const counts = { recorded: 0, skipped: 0, failed: 0 };
  for (const txn of deposits) {
    const row = toBankTxnRow(accountId, txn);
    if (!row) { counts.skipped++; continue; }
    try { await sink.recordBankTxn(row); counts.recorded++; }
    catch { counts.failed++; }
  }
  return counts;
}
