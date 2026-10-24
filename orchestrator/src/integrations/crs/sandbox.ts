/**
 * Sponsor-published Cal Hacks CRS sandbox configuration (Refs #4).
 *
 * The Cal Hacks sandbox serves no business-credit or standalone OFAC product, so this module
 * configures only the two products that map honestly onto our flows:
 *   - publicRecords: PitchPoint bankruptcies, liens and judgments (feeds the spec §1.4 bankruptcy stop)
 *   - fraudRisk: Fraud Finder (AtData) email risk (vendor bank-change verification)
 * Routes and bodies come from @crscreditapi/crs-calhacks-mcp-server@1.1.2 (guides + test data).
 */
import type { CrsOptions, CrsProductAdapter, CrsSandboxIdentity } from './index.js';
import { CRS_CALHACKS_PERSONAS } from './personas.js';

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
