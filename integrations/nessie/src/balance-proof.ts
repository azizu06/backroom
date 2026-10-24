import { type Account, type Claims, NessieClient, NessieError, SANDBOX_LABEL } from './index';

/**
 * Track-readiness item 4 (#231): show a Nessie balance visibly rising, honestly.
 * The hosted sandbox has never applied deposits to account.balance (docs/t4-nessie.md), so this records
 * both the provider balance and the labelled display formula, from a fresh zero-balance account.
 */
export interface BalanceSnapshot { accountBalance: number; postedDepositsTotal: number; displayTotal: number }
export interface BalanceProofOptions {
  /** Create resources; without it the run only reads. */
  confirm: boolean;
  /** Whole dollars for the proof deposit; 0 creates the account only. */
  depositDollars: number;
  pollMs?: number; pollAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}
export interface BalanceProofResult {
  label: string;
  /** Read-only re-check of the original Northfield account and its oldest posted deposit. */
  northfield?: BalanceSnapshot & { oldestDepositDate?: string; providerApplied: boolean };
  fresh?: {
    accountId: string; nickname: string; before: BalanceSnapshot; after: BalanceSnapshot;
    depositId?: string; providerBalanceRose: boolean; displayRose: boolean; polls: number;
  };
}

const NORTHFIELD_NICKNAME = `Northfield Studio Checking (${SANDBOX_LABEL})`;
const snapshot = async (client: NessieClient, accountId: string): Promise<BalanceSnapshot> => {
  const { accountBalance, postedDepositsTotal, displayTotal } = await client.readBalanceWithPostedDeposits(accountId);
  return { accountBalance, postedDepositsTotal, displayTotal };
};

export async function runBalanceProof(client: NessieClient, claims: Claims, options: BalanceProofOptions): Promise<BalanceProofResult> {
  if (!Number.isSafeInteger(options.depositDollars) || options.depositDollars < 0) throw new NessieError('depositDollars must be a whole number of dollars');
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const result: BalanceProofResult = { label: SANDBOX_LABEL };
  // Read only: never create the customer here; the seed owns that.
  const customers = (await client.listCustomers()).filter(c => c.first_name === 'Northfield' && c.last_name === 'Studio');
  if (customers.length !== 1) throw new NessieError(customers.length ? 'ambiguous Northfield customers' : 'Northfield customer missing: run the T4 seed first');
  const customer = customers[0]!;
  const accounts = await client.listAccounts(customer._id);
  const northfield = accounts.find(a => a.nickname === NORTHFIELD_NICKNAME && a.type === 'Checking');
  if (northfield) {
    const balance = await snapshot(client, northfield._id);
    const dates = (await client.listDeposits(northfield._id)).filter(d => d.status === 'completed').map(d => d.transaction_date).sort();
    result.northfield = { ...balance, oldestDepositDate: dates[0], providerApplied: balance.postedDepositsTotal > 0 && balance.accountBalance > 0 };
  }
  if (!options.confirm) return result;

  const stamp = (options.now ?? (() => new Date()))().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const nickname = `Backrooms Demo Payee ${stamp} (${SANDBOX_LABEL})`;
  let account: Account | undefined = accounts.find(a => a.nickname === nickname);
  if (!account) {
    // One durable claim per stamp: an ambiguous create is never re-POSTed.
    if (!await claims.claim(`balance-proof:${customer._id}:${stamp}`)) throw new NessieError('fresh account reserved: check the customer accounts before retrying');
    account = await client.createAccount(customer._id, { type: 'Checking', nickname, balance: 0, rewards: 0 });
  }
  if (!account?._id) throw new NessieError('account response missing ID');
  const before = await snapshot(client, account._id);
  let after = before, depositId: string | undefined, polls = 0;
  if (options.depositDollars > 0) {
    depositId = (await client.deposit({ accountId: account._id, invoiceId: `balance-proof-${stamp}`, installment: 1, amountCents: options.depositDollars * 100 }))._id;
    const attempts = options.pollAttempts ?? 9;
    for (polls = 1; polls <= attempts; polls++) {
      after = await snapshot(client, account._id);
      if (after.accountBalance > before.accountBalance || polls === attempts) break;
      await sleep(options.pollMs ?? 10_000);
    }
  }
  result.fresh = { accountId: account._id, nickname, before, after, depositId,
    providerBalanceRose: after.accountBalance > before.accountBalance, displayRose: after.displayTotal > before.displayTotal, polls };
  return result;
}
