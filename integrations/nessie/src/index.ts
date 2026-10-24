import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

export const SANDBOX_LABEL = 'Nessie = sandbox bank';
export const POSTED_DEPOSITS_LABEL = 'Nessie account balance + Nessie-reported posted deposits';
export interface PostedDepositsDisplay {
  label: typeof POSTED_DEPOSITS_LABEL; sandboxLabel: typeof SANDBOX_LABEL;
  accountBalance: number; postedDepositsTotal: number; displayTotal: number; postedDepositIds: string[];
}
export interface CustomerInput {
  first_name: string; last_name: string;
  address: { street_number: string; street_name: string; city: string; state: string; zip: string };
}
export interface Customer extends CustomerInput { _id: string }
export interface AccountInput { type: 'Checking' | 'Savings' | 'Credit Card'; nickname: string; balance: number; rewards: number }
export interface Account extends AccountInput { _id: string; customer_id: string; account_number?: string }
export interface Transaction {
  _id: string; amount: number; description: string; status: string;
  medium: string; transaction_date: string;
}
export interface Payment { accountId: string; invoiceId: string; installment: number; amountCents: number }
/** Atomic, durable, shared by ALL writers to an account. A claimed operation is never automatically re-POSTed. */
export interface Claims { claim(key: string): Promise<boolean> }
export class FileClaims implements Claims {
  constructor(private readonly directory: string) {}
  async claim(key: string): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, createHash('sha256').update(key).digest('hex'));
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile('reserved\n'); await handle.sync(); } finally { await handle.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }
}
export class NessieError extends Error {
  /** outage: the bank was unreachable or failing (network, timeout, 429/5xx), as opposed to invalid data or a refusal. */
  constructor(message: string, readonly status?: number, readonly outage = false) { super(`${SANDBOX_LABEL}: ${message}`); }
}
/** Balance display with its freshness: live, or the last good read during a Nessie outage (spec 6.3). */
export type BalanceDisplay = PostedDepositsDisplay & { cached: boolean; observedAt: string; freshness: string };
/** Holds display figures only (balances, deposit IDs); never a deposit request or a reconciliation input. */
export interface BalanceDisplayCache {
  get(accountId: string): Promise<{ display: PostedDepositsDisplay; observedAt: string } | undefined>;
  set(accountId: string, entry: { display: PostedDepositsDisplay; observedAt: string }): Promise<void>;
}
export class MemoryBalanceDisplayCache implements BalanceDisplayCache {
  private readonly rows = new Map<string, { display: PostedDepositsDisplay; observedAt: string }>();
  async get(accountId: string) { const row = this.rows.get(accountId); return row && structuredClone(row); }
  async set(accountId: string, entry: { display: PostedDepositsDisplay; observedAt: string }) { this.rows.set(accountId, structuredClone(entry)); }
}
export const BALANCE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface ClientOptions {
  apiKey: string; claims: Claims; fetch?: typeof fetch; baseUrl?: string;
  readAttempts?: number; timeoutMs?: number;
  /** Opt-in outage fallback for readBalanceDisplay only. */
  displayCache?: BalanceDisplayCache; displayCacheMaxAgeMs?: number; now?: () => number;
  observe?: (event: { method: string; path: string; status: number; elapsedMs: number; shape: unknown }) => void;
}
const segment = (value: string) => encodeURIComponent(value);
export function paymentMemo(payment: Pick<Payment, 'invoiceId' | 'installment'>): string {
  if (!payment.invoiceId.trim() || !Number.isSafeInteger(payment.installment) || payment.installment < 1) throw new NessieError('invalid payment reference');
  return `backroom:invoice=${segment(payment.invoiceId)}:installment=${payment.installment}`;
}
export class NessieClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly options: ClientOptions) {
    if (!options.apiKey) throw new NessieError('API key required');
    this.fetcher = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://prod-api.nessieisreal.com';
    if (new URL(this.baseUrl).protocol !== 'https:') throw new NessieError('HTTPS required');
  }
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl); url.searchParams.set('key', this.options.apiKey);
    const attempts = method === 'GET' ? (this.options.readAttempts ?? 3) : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const started = performance.now();
      let response: Response;
      try {
        response = await this.fetcher(url, { method, headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.options.timeoutMs ?? 10000) });
      } catch {
        // Network failure or timeout: the only transport outage. Never propagate fetch errors: they may contain the key-bearing URL.
        if (method === 'GET' && attempt + 1 < attempts) { await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt)); continue; }
        throw new NessieError(`${method} ${path} response uncertain`, undefined, true);
      }
      if (!response.ok) {
        if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
          await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt)); continue;
        }
        throw new NessieError(`${method} ${path} failed`, response.status, response.status === 429 || response.status >= 500);
      }
      // A reachable bank that answers with a body we cannot read is invalid data, not an outage.
      let result: unknown;
      try { result = await response.json(); } catch {
        if (method !== 'GET') throw new NessieError(`${method} ${path} response uncertain`);
        throw new NessieError(`${method} ${path} returned an unreadable body`);
      }
      try { this.options.observe?.({ method, path, status: response.status, elapsedMs: Math.round(performance.now() - started), shape: result }); }
      catch { /* An observer must never change the bank result. */ }
      return result as T;
    }
    throw new NessieError('read attempts exhausted', undefined, true);
  }
  private async create<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request<T | { objectCreated: T }>('POST', path, body);
    return typeof response === 'object' && response !== null && 'objectCreated' in response ? response.objectCreated : response as T;
  }
  listCustomers() { return this.request<Customer[]>('GET', '/customers'); }
  getCustomer(id: string) { return this.request<Customer>('GET', `/customers/${segment(id)}`); }
  createCustomer(input: CustomerInput) { return this.create<Customer>('/customers', input); }
  listAccounts(customerId: string) { return this.request<Account[]>('GET', `/customers/${segment(customerId)}/accounts`); }
  getAccount(id: string) { return this.request<Account>('GET', `/accounts/${segment(id)}`); }
  createAccount(customerId: string, input: AccountInput) { return this.create<Account>(`/customers/${segment(customerId)}/accounts`, input); }
  async readBalance(accountId: string): Promise<number> { return (await this.getAccount(accountId)).balance; }
  /** Explicit sandbox display formula, NOT the bank's balance or a settlement signal.
   * Enable only while the hosted sandbox demonstrably leaves deposits out of account.balance.
   */
  async readBalanceWithPostedDeposits(accountId: string): Promise<PostedDepositsDisplay> {
    const [accountBalance, deposits] = await Promise.all([this.readBalance(accountId), this.listDeposits(accountId)]);
    if (!Number.isSafeInteger(accountBalance) || accountBalance < 0) throw new NessieError('invalid account balance');
    const ids = new Set<string>();
    let postedDepositsTotal = 0;
    for (const deposit of deposits) {
      if (deposit.status !== 'completed' || deposit.medium !== 'balance') continue;
      if (!deposit._id || ids.has(deposit._id) || !Number.isSafeInteger(deposit.amount) || deposit.amount <= 0) {
        throw new NessieError('invalid posted deposit: duplicate ID or amount');
      }
      ids.add(deposit._id); postedDepositsTotal += deposit.amount;
    }
    const displayTotal = accountBalance + postedDepositsTotal;
    if (!Number.isSafeInteger(displayTotal)) throw new NessieError('invalid posted deposit total');
    return { label: POSTED_DEPOSITS_LABEL, sandboxLabel: SANDBOX_LABEL, accountBalance, postedDepositsTotal,
      displayTotal, postedDepositIds: [...ids] };
  }
  /**
   * readBalanceWithPostedDeposits for display, live first. During a Nessie outage only, it returns the last good
   * figures labelled "cached at HH:MM UTC" (at most 24 h old). Invalid data and refusals still throw. Health probes,
   * deposits and reconciliation must keep using the live methods.
   */
  async readBalanceDisplay(accountId: string): Promise<BalanceDisplay> {
    const now = this.options.now ?? Date.now;
    try {
      const display = await this.readBalanceWithPostedDeposits(accountId);
      const observedAt = new Date(now()).toISOString();
      await this.options.displayCache?.set(accountId, { display, observedAt }).catch(() => undefined);
      return { ...display, cached: false, observedAt, freshness: 'live' };
    } catch (error) {
      const cache = this.options.displayCache;
      if (!cache || !(error instanceof NessieError) || !error.outage) throw error;
      const hit = await cache.get(accountId).catch(() => undefined);
      const observed = hit ? Date.parse(hit.observedAt) : NaN;
      if (!hit || !Number.isFinite(observed) || now() - observed > (this.options.displayCacheMaxAgeMs ?? BALANCE_CACHE_MAX_AGE_MS)) throw error;
      return { ...hit.display, cached: true, observedAt: hit.observedAt, freshness: `cached at ${new Date(observed).toISOString().slice(11, 16)} UTC` };
    }
  }
  listDeposits(accountId: string) { return this.request<Transaction[]>('GET', `/accounts/${segment(accountId)}/deposits`); }
  /** Bank feed: each collection remains tagged; no fictional aggregate /transactions endpoint. */
  async listTransactions(accountId: string) {
    const kinds = ['deposits', 'withdrawals'] as const;
    const collections = await Promise.all(kinds.map(async kind => {
      const rows = await this.request<Transaction[]>('GET', `/accounts/${segment(accountId)}/${kind}`);
      return rows.map(row => ({ ...row, kind }));
    }));
    return collections.flat();
  }
  async deposit(payment: Payment): Promise<Transaction> {
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new NessieError('positive integer amountCents required');
    if (payment.amountCents % 100 !== 0) throw new NessieError('whole-dollar amounts required by integer-only sandbox; fractional dollars are truncated');
    const description = paymentMemo(payment);
    const existing = async () => {
      const matches = (await this.listDeposits(payment.accountId)).filter(row => row.description === description);
      if (matches.length > 1) throw new NessieError('duplicate reference: reconciliation required');
      const found = matches[0];
      if (found && (Math.round(found.amount * 100) !== payment.amountCents || found.status === 'cancelled')) throw new NessieError('payment reference conflict');
      return found;
    };
    const found = await existing(); if (found) return found;
    if (!await this.options.claims.claim(`deposit:${payment.accountId}:${description}`)) {
      const recovered = await existing(); if (recovered) return recovered;
      throw new NessieError('deposit uncertain: reserved reference requires reconciliation; will not re-POST');
    }
    try {
      const created = await this.create<Transaction>(`/accounts/${segment(payment.accountId)}/deposits`, {
        medium: 'balance', transaction_date: new Date().toISOString().slice(0, 10), status: 'completed', amount: payment.amountCents / 100, description,
      });
      if (!created?._id || created.description !== description || Math.round(created.amount * 100) !== payment.amountCents) throw new NessieError('deposit response mismatch');
      return created;
    } catch {
      const recovered = await existing(); if (recovered) return recovered;
      throw new NessieError('deposit uncertain: reconcile reserved reference before any manual action');
    }
  }
}

/** Uses the same durable claim domain as deposits; seed writes also fail closed after ambiguous responses. */
export async function seedNorthfield(client: NessieClient, claims: Claims): Promise<{ customer: Customer; account: Account }> {
  let customers = (await client.listCustomers()).filter(c => c.first_name === 'Northfield' && c.last_name === 'Studio');
  if (customers.length > 1) throw new NessieError('ambiguous Northfield customers');
  let customer = customers[0];
  if (!customer) {
    if (!await claims.claim('seed:northfield:customer')) throw new NessieError('customer seed reserved: reconcile before retry');
    customer = await client.createCustomer({ first_name: 'Northfield', last_name: 'Studio', address: { street_number: '1', street_name: 'Sandbox Way', city: 'Berkeley', state: 'CA', zip: '94704' } });
  }
  if (!customer?._id) throw new NessieError('customer response missing ID');
  const nickname = `Northfield Studio Checking (${SANDBOX_LABEL})`;
  const accounts = (await client.listAccounts(customer._id)).filter(a => a.nickname === nickname && a.type === 'Checking');
  if (accounts.length > 1) throw new NessieError('ambiguous Northfield accounts');
  let account = accounts[0];
  if (!account) {
    if (!await claims.claim(`seed:${customer._id}:checking`)) throw new NessieError('account seed reserved: reconcile before retry');
    account = await client.createAccount(customer._id, { type: 'Checking', nickname, balance: 0, rewards: 0 });
  }
  if (!account?._id) throw new NessieError('account response missing ID');
  return { customer, account };
}
