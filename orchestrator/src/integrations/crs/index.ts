import { createHash } from 'node:crypto';

export const CRS_SANDBOX_URL = 'https://api-sandbox.stitchcredit.com/api';
export class CrsError extends Error {
  constructor(public readonly code: 'AUTH' | 'HTTP' | 'RESPONSE' | 'TRANSPORT' | 'CONFIGURATION', public readonly status?: number) {
    super(`CRS ${code}${status === undefined ? '' : ` (${status})`}`);
    this.name = 'CrsError';
  }
}

export interface CrsOptions {
  username: string;
  password: string;
  fetch?: typeof fetch;
  identities?: readonly CrsSandboxIdentity[];
  products?: Partial<{ businessCredit: CrsProductAdapter; ofac: CrsProductAdapter }>;
}

export type CrsProduct = 'businessCredit' | 'ofac';
export type OfacStatus = 'clear' | 'hit' | 'unknown';
export interface CrsSummary { creditScore?: number; ofacStatus?: OfacStatus }
/** Trusted server configuration copied verbatim from sponsor-confirmed sandbox data. */
export interface CrsSandboxIdentity {
  testIdentityId: number;
  source: string;
  businessCredit?: Record<string, unknown>;
  ofac?: Record<string, unknown>;
}
export interface CrsProductAdapter {
  path: string;
  summarize(body: Record<string, unknown>): CrsSummary;
}
export interface CrsEvidence {
  source: 'crs_sandbox';
  product: CrsProduct;
  testIdentityId: number;
  label: string;
  checkedAt: string;
  responseHash: string;
  summary: CrsSummary;
}

/** Server only. Tokens and provider response bodies never leave this boundary. */
export class CrsClient {
  #token?: string;
  #refreshToken?: string;
  #authentication?: Promise<void>;
  #authFailed = false;
  readonly #fetch: typeof fetch;
  readonly #identities: readonly CrsSandboxIdentity[];
  readonly #products: CrsOptions['products'];
  #renewing?: Promise<void>;
  readonly #credentials: { username: string; password: string };
  constructor(options: CrsOptions) {
    this.#credentials = { username: options.username, password: options.password };
    this.#fetch = options.fetch ?? fetch;
    this.#identities = structuredClone(options.identities ?? []);
    this.#products = options.products ? Object.fromEntries(Object.entries(options.products).map(([key, value]) => [key, { ...value }])) : undefined;
  }

  async #post(path: string, body: unknown, token?: string): Promise<Response> {
    try {
      return await this.#fetch(`${CRS_SANDBOX_URL}${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    } catch { throw new CrsError('TRANSPORT'); }
  }

  async #json(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) throw new CrsError('HTTP', response.status);
    try {
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch { throw new CrsError('RESPONSE'); }
  }

  async login(): Promise<void> {
    if (!this.#credentials.username.trim() || !this.#credentials.password) throw new CrsError('CONFIGURATION');
    if (this.#token) return;
    if (this.#authFailed) throw new CrsError('AUTH');
    if (!this.#authentication) {
      this.#authentication = (async () => {
        try {
          const body = await this.#json(await this.#post('/users/login', this.#credentials));
          this.#setTokens(body);
        } catch {
          // CRS warns repeated failed logins disable the account. New client required after correction.
          this.#authFailed = true;
          throw new CrsError('AUTH');
        }
      })().finally(() => { this.#authentication = undefined; });
    }
    return this.#authentication;
  }

  /** Renew only on a product 401; refreshing immediately after login yields CRS117. */
  async #renew(staleToken: string): Promise<void> {
    if (this.#token !== staleToken) return;
    if (!this.#renewing) {
      this.#renewing = (async () => {
        try {
          if (this.#refreshToken) {
            this.#setTokens(await this.#json(await this.#post('/users/refresh-token', { refreshToken: this.#refreshToken })));
          } else {
            this.#token = undefined;
            await this.login();
          }
        } catch {
          this.#token = undefined;
          this.#refreshToken = undefined;
          this.#authFailed = true;
          throw new CrsError('AUTH');
        }
      })().finally(() => { this.#renewing = undefined; });
    }
    return this.#renewing;
  }

  getBusinessCreditReport(testIdentityId: number): Promise<CrsEvidence> {
    return this.#run('businessCredit', testIdentityId);
  }

  checkOfac(testIdentityId: number): Promise<CrsEvidence> {
    return this.#run('ofac', testIdentityId);
  }

  async #run(product: CrsProduct, testIdentityId: number): Promise<CrsEvidence> {
    const identity = this.#identities.find(item => item.testIdentityId === testIdentityId);
    const adapter = this.#products?.[product];
    const request = identity?.[product];
    // No free-form identity input and no production host override. Missing configuration makes zero calls.
    if (!Number.isSafeInteger(testIdentityId) || testIdentityId < 1 || !identity?.source || !request || !Object.keys(request).length || !adapter ||
      !/^\/[a-zA-Z0-9_/-]+$/.test(adapter.path) || adapter.path.includes('..') || adapter.path.startsWith('//') || adapter.path.startsWith('/users')) {
      throw new CrsError('CONFIGURATION');
    }
    await this.login();
    const token = this.#token!;
    let response = await this.#post(adapter.path, request, token);
    if (response.status === 401) {
      await this.#renew(token);
      response = await this.#post(adapter.path, request, this.#token);
    }
    const body = await this.#json(response);
    // Credit products can return HTTP 200 with errorMessages. Never treat that as a report.
    if (body.errorMessages != null && (!Array.isArray(body.errorMessages) || body.errorMessages.length > 0)) throw new CrsError('RESPONSE');
    let parsed: CrsSummary;
    try { parsed = adapter.summarize(body); } catch { throw new CrsError('RESPONSE'); }
    // Project only numeric/enum values; raw names, addresses and other response fields cannot escape.
    const summary: CrsSummary = product === 'ofac'
      ? { ofacStatus: parsed.ofacStatus === 'hit' || parsed.ofacStatus === 'clear' ? parsed.ofacStatus : 'unknown' }
      : typeof parsed.creditScore === 'number' && Number.isFinite(parsed.creditScore)
        ? { creditScore: parsed.creditScore } : {};
    return {
      source: 'crs_sandbox', product, testIdentityId,
      label: `SANDBOX: test identity #${testIdentityId}`, checkedAt: new Date().toISOString(),
      responseHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), summary,
    };
  }

  #setTokens(body: Record<string, unknown>): void {
    if (typeof body.token !== 'string' || !body.token) throw new CrsError('AUTH');
    this.#token = body.token;
    this.#refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
  }
}
