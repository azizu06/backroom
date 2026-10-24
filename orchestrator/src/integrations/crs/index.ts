import { createHash } from 'node:crypto';

export const CRS_SANDBOX_URL = 'https://api-sandbox.stitchcredit.com/api';
export class CrsError extends Error {
  constructor(public readonly code: 'AUTH' | 'HTTP' | 'RESPONSE' | 'TRANSPORT' | 'CONFIGURATION', public readonly status?: number, step?: string) {
    super(`CRS ${code}${status === undefined ? '' : ` (${status})`}${step ? ` at ${step}` : ''}`);
    this.name = 'CrsError';
  }
}

export interface CrsOptions {
  username: string;
  password: string;
  fetch?: typeof fetch;
  identities?: readonly CrsSandboxIdentity[];
  products?: Partial<Record<CrsProduct, CrsProductAdapter>>;
  /** Offline fixture transport: evidence is marked crs_fixture / FAKE so it can never pass as a live sandbox call. */
  fixture?: boolean;
}

/** publicRecords (PitchPoint) and fraudRisk (Fraud Finder) are the products the Cal Hacks sandbox serves; see ./sandbox.ts. */
export type CrsProduct = 'businessCredit' | 'ofac' | 'publicRecords' | 'fraudRisk';
export type OfacStatus = 'clear' | 'hit' | 'unknown';
export interface CrsSummary {
  creditScore?: number;
  ofacStatus?: OfacStatus;
  bankruptcies?: number;
  judgments?: number;
  liens?: number;
  /** AtData risk.score, 0-100, higher is riskier. */
  fraudRiskScore?: number;
}
/** Trusted server configuration copied verbatim from sponsor-confirmed sandbox data. */
export interface CrsSandboxIdentity {
  testIdentityId: number;
  source: string;
  businessCredit?: Record<string, unknown>;
  ofac?: Record<string, unknown>;
  publicRecords?: Record<string, unknown>;
  fraudRisk?: Record<string, unknown>;
}
export interface CrsProductAdapter {
  path: string;
  summarize(body: Record<string, unknown>): CrsSummary;
}
export interface CrsEvidence {
  source: 'crs_sandbox' | 'crs_fixture';
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
  readonly #fixture: boolean;
  constructor(options: CrsOptions) {
    this.#credentials = { username: options.username, password: options.password };
    this.#fetch = options.fetch ?? fetch;
    this.#fixture = options.fixture === true;
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
        } catch (error) {
          // CRS warns repeated failed logins disable the account. New client required after correction.
          this.#authFailed = true;
          throw new CrsError('AUTH', error instanceof CrsError ? error.status : undefined);
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

  /** PitchPoint bankruptcies, liens and judgments for the approved test identity. */
  getPublicRecords(testIdentityId: number): Promise<CrsEvidence> {
    return this.#run('publicRecords', testIdentityId);
  }

  /** Fraud Finder (AtData) email risk for the approved test identity. */
  getFraudRisk(testIdentityId: number): Promise<CrsEvidence> {
    return this.#run('fraudRisk', testIdentityId);
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
    const summary = project(product, parsed);
    return {
      source: this.#fixture ? 'crs_fixture' : 'crs_sandbox', product, testIdentityId,
      label: this.#fixture ? `FAKE: CRS fixture, test identity #${testIdentityId}` : `SANDBOX: test identity #${testIdentityId}`,
      checkedAt: new Date().toISOString(),
      responseHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), summary,
    };
  }

  #setTokens(body: Record<string, unknown>): void {
    if (typeof body.token !== 'string' || !body.token) throw new CrsError('AUTH');
    this.#token = body.token;
    this.#refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
  }
}

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function project(product: CrsProduct, parsed: CrsSummary): CrsSummary {
  switch (product) {
    case 'ofac':
      return { ofacStatus: parsed.ofacStatus === 'hit' || parsed.ofacStatus === 'clear' ? parsed.ofacStatus : 'unknown' };
    case 'businessCredit':
      return typeof parsed.creditScore === 'number' && Number.isFinite(parsed.creditScore) ? { creditScore: parsed.creditScore } : {};
    case 'publicRecords': {
      const bankruptcies = count(parsed.bankruptcies), judgments = count(parsed.judgments), liens = count(parsed.liens);
      // A partial count could read as "no bankruptcy"; the bankruptcy stop needs all three or none.
      if (bankruptcies === undefined || judgments === undefined || liens === undefined) throw new CrsError('RESPONSE');
      return { bankruptcies, judgments, liens };
    }
    case 'fraudRisk': {
      const score = parsed.fraudRiskScore;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) throw new CrsError('RESPONSE');
      return { fraudRiskScore: score };
    }
  }
}
