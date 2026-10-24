/**
 * Sponsor-published Cal Hacks CRS sandbox configuration (Refs #4).
 *
 * The Cal Hacks sandbox serves no business-credit or standalone OFAC product, so this module
 * configures only the two products that map honestly onto our flows:
 *   - publicRecords: PitchPoint bankruptcies, liens and judgments (feeds the spec §1.4 bankruptcy stop)
 *   - fraudRisk: Fraud Finder (AtData) email risk (vendor bank-change verification)
 * Routes and bodies come from @crscreditapi/crs-calhacks-mcp-server@1.1.2 (guides + test data).
 */
import { CrsClient, type CrsOptions, type CrsProductAdapter, type CrsSandboxIdentity, type CrsSummary } from './index';
import { CRS_CALHACKS_PERSONAS } from './personas';
import { FileCrsEvidenceCache } from './cache';

export { CRS_CALHACKS_PERSONAS };
export const CRS_SANDBOX_SOURCE = '@crscreditapi/crs-calhacks-mcp-server@1.1.2 test-data/personas.json';
/** AtData suggests treating 70-80 and above as risky. */
export const CRS_FRAUD_RISK_THRESHOLD = 70;

const PITCHPOINT_COUNTS = { BankruptciesFound: 'bankruptcies', JudgmentsFound: 'judgments', LiensFound: 'liens' } as const;
type PitchPointCount = (typeof PITCHPOINT_COUNTS)[keyof typeof PITCHPOINT_COUNTS];

/** PitchPoint /data mirrors its XML element names; find the three counts wherever they are nested. */
function findPitchPointCounts(body: unknown): Partial<Record<PitchPointCount, number>> {
  const found: Partial<Record<PitchPointCount, number>> = {};
  const stack: unknown[] = [body];
  for (let visited = 0; stack.length && visited < 10_000; visited++) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    for (const [key, value] of Object.entries(node)) {
      const field = PITCHPOINT_COUNTS[key as keyof typeof PITCHPOINT_COUNTS];
      if (field && found[field] === undefined) {
        const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
        if (typeof number === 'number') found[field] = number;
      } else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return found;
}

export const CRS_SANDBOX_PRODUCTS: Readonly<Record<'publicRecords' | 'fraudRisk', CrsProductAdapter>> = {
  publicRecords: { path: '/pp/fcrablj/data', summarize: findPitchPointCounts },
  fraudRisk: {
    path: '/fraud-finder/fraud-finder',
    summarize: body => {
      const risk = body.risk;
      const score = risk && typeof risk === 'object' ? (risk as Record<string, unknown>).score : undefined;
      return { fraudRiskScore: typeof score === 'number' ? score : undefined };
    },
  },
};

export const CRS_SANDBOX_IDENTITIES: readonly CrsSandboxIdentity[] = CRS_CALHACKS_PERSONAS.map(persona => ({
  testIdentityId: persona.testIdentityId,
  source: `${CRS_SANDBOX_SOURCE} ${persona.persona}`,
  publicRecords: persona.publicRecords,
  fraudRisk: persona.fraudRisk,
}));

/** Pass to `new CrsClient({ username, password, ...CRS_CALHACKS_SANDBOX })`. */
export const CRS_CALHACKS_SANDBOX: Pick<CrsOptions, 'identities' | 'products'> = {
  identities: CRS_SANDBOX_IDENTITIES,
  products: CRS_SANDBOX_PRODUCTS,
};

/**
 * CRS's published outcome per persona (personas.json `expected`), as the client's summary fields.
 * PitchPoint counts do not say whether a bankruptcy is open (P07, Ch.13) or discharged (P06, Ch.7).
 */
export const CRS_SANDBOX_EXPECTED: Readonly<Record<number, Required<Pick<CrsSummary, 'bankruptcies' | 'judgments' | 'liens' | 'fraudRiskScore'>>>> = Object.fromEntries(
  ([[11], [9], [14], [18], [52], [12, 1], [12, 1], [10, 0, 1, 1], [11], [10], [11, 0, 1], [85], [88], [80], [10], [50], [11], [12], [9], [8]] as const)
    .map(([fraudRiskScore, bankruptcies = 0, judgments = 0, liens = 0], index) => [index + 1, { bankruptcies, judgments, liens, fraudRiskScore }]),
);

const fixtureJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sameBody = (sent: unknown, persona: unknown) => JSON.stringify(sent) === JSON.stringify(persona);

/**
 * Offline stand-in for the CRS sandbox: guide-shaped PitchPoint and AtData bodies carrying each persona's
 * published counts and score. Like the real sandbox, only an exact persona body gets an answer.
 * Use in tests and FAKE-labelled demo runs; it is not evidence of a live call.
 */
export const crsSandboxFixtureFetch: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname.replace(/^\/api/, '');
  let body: unknown;
  try { body = JSON.parse(String(init?.body ?? 'null')); } catch { return fixtureJson({ codes: ['CRS200'] }, 400); }
  if (path === '/users/login') return fixtureJson({ token: 'fixture-token', refreshToken: 'fixture-refresh' });
  for (const persona of CRS_CALHACKS_PERSONAS) {
    const expected = CRS_SANDBOX_EXPECTED[persona.testIdentityId]!;
    if (path === CRS_SANDBOX_PRODUCTS.publicRecords.path && sameBody(body, persona.publicRecords)) {
      return fixtureJson({ Report: { Summary: { BankruptciesFound: String(expected.bankruptcies), JudgmentsFound: String(expected.judgments), LiensFound: String(expected.liens) } } });
    }
    if (path === CRS_SANDBOX_PRODUCTS.fraudRisk.path && sameBody(body, persona.fraudRisk)) {
      return fixtureJson({ risk: { score: expected.fraudRiskScore, tumbling_risk: 0 } });
    }
  }
  return fixtureJson({ codes: ['CRS200'], messages: ['Not a sandbox persona request'] }, 400);
};

/**
 * Live sandbox client when CRS_USERNAME and CRS_PASSWORD are set; otherwise undefined, so callers fall back to fixtures.
 * CRS_CACHE_FILE opts into the spec 6.3 outage fallback: last good evidence, labelled "cached at HH:MM UTC".
 */
export function createCrsClientFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): CrsClient | undefined {
  if (!env.CRS_USERNAME?.trim() || !env.CRS_PASSWORD) return undefined;
  const cache = env.CRS_CACHE_FILE?.trim() ? new FileCrsEvidenceCache(env.CRS_CACHE_FILE.trim()) : undefined;
  return new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: env.CRS_USERNAME, password: env.CRS_PASSWORD, fetch: fetchImpl, cache });
}

/** Offline client over crsSandboxFixtureFetch. Its evidence is source crs_fixture with a FAKE label. */
export function createCrsFixtureClient(): CrsClient {
  return new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: 'fixture', password: 'fixture', fetch: crsSandboxFixtureFetch, fixture: true });
}
