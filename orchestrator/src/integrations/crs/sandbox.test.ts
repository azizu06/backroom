import { describe, expect, it, vi } from 'vitest';
import { CrsClient } from './index.js';
import { CRS_CALHACKS_PERSONAS, CRS_CALHACKS_SANDBOX, CRS_SANDBOX_EXPECTED, CRS_SANDBOX_IDENTITIES, createCrsClientFromEnv, createCrsFixtureClient, crsSandboxFixtureFetch } from './sandbox.js';

// Product responses are shaped from the CRS guides (PitchPoint XML-named counts, AtData risk.score);
// they are NOT recorded vendor responses. A live probe (pnpm crs:live) is still required for T3.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const client = (network: typeof fetch) => new CrsClient({ username: 'u', password: 'p', fetch: network, ...CRS_CALHACKS_SANDBOX });

describe('Cal Hacks sandbox personas', () => {
  it('maps P01-P20 to test identities 1-20 with complete persona bodies', () => {
    expect(CRS_CALHACKS_PERSONAS.map(persona => persona.persona)).toEqual(Array.from({ length: 20 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
    for (const persona of CRS_CALHACKS_PERSONAS) {
      const person = persona.publicRecords.terms.term[0].person;
      // Sandbox SSNs are the never-issued 666 range; a typo here would leave the canned dataset.
      expect(person.ssn).toBe(`6667010${String(persona.testIdentityId).padStart(2, '0')}`);
      expect(persona.fraudRisk).toMatchObject({ firstName: person.firstName, lastName: person.lastName, email: expect.stringMatching(/@example\.com$/) });
      expect(Object.keys(persona.fraudRisk.address)).toEqual(['addressLine1', 'city', 'state', 'postalCode']);
    }
    expect(CRS_SANDBOX_IDENTITIES.every(identity => !identity.businessCredit && !identity.ofac)).toBe(true);
  });
});

describe('PitchPoint public records', () => {
  it('sends the verbatim persona body and returns only the three counts', async () => {
    const network = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ token: 'token' }))
      .mockResolvedValueOnce(json({ Report: { Summary: { BankruptciesFound: '1', JudgmentsFound: '0', LiensFound: 0 }, Name: 'ANGELA MORRISSEY' } }));
    const result = await client(network).getPublicRecords(6);
    expect(result).toMatchObject({ product: 'publicRecords', label: 'SANDBOX: test identity #6', summary: { bankruptcies: 1, judgments: 0, liens: 0 } });
    expect(network.mock.calls[1]?.[0]).toBe('https://api-sandbox.stitchcredit.com/api/pp/fcrablj/data');
    expect(JSON.parse(String(network.mock.calls[1]?.[1]?.body))).toEqual(CRS_CALHACKS_PERSONAS[5].publicRecords);
    expect(JSON.stringify(result)).not.toContain('MORRISSEY');
  });

  it('refuses a partial report instead of reading it as no bankruptcy', async () => {
    const network = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ token: 'token' }))
      .mockResolvedValueOnce(json({ Report: { JudgmentsFound: '0', LiensFound: '0' } }));
    await expect(client(network).getPublicRecords(7)).rejects.toMatchObject({ code: 'RESPONSE' });
  });
});

describe('Fraud Finder risk', () => {
  it('returns the AtData score for the synthetic-identity persona', async () => {
    const network = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ token: 'token' }))
      .mockResolvedValueOnce(json({ risk: { score: 88, tumbling_risk: 0 }, email_validation: { address: 'kb.9921x@example.com' } }));
    const result = await client(network).getFraudRisk(13);
    expect(result.summary).toEqual({ fraudRiskScore: 88 });
    expect(network.mock.calls[1]?.[0]).toBe('https://api-sandbox.stitchcredit.com/api/fraud-finder/fraud-finder');
    expect(JSON.parse(String(network.mock.calls[1]?.[1]?.body))).toEqual(CRS_CALHACKS_PERSONAS[12].fraudRisk);
    expect(JSON.stringify(result)).not.toContain('example.com');
  });

  it.each([[{ risk: {} }], [{ risk: { score: 140 } }], [{ score: 10 }]])('rejects a missing or out-of-range score %#', async body => {
    const network = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(json(body));
    await expect(client(network).getFraudRisk(1)).rejects.toMatchObject({ code: 'RESPONSE' });
  });

  it('still refuses business credit and OFAC, which the sandbox does not serve, before login', async () => {
    const network = vi.fn<typeof fetch>();
    await expect(client(network).checkOfac(1)).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await expect(client(network).getFraudRisk(21)).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(network).not.toHaveBeenCalled();
  });
});

describe('offline sandbox fixture', () => {
  it('returns every persona\'s published counts and score through the real client', async () => {
    const client = createCrsFixtureClient();
    for (const { testIdentityId } of CRS_CALHACKS_PERSONAS) {
      const { bankruptcies, judgments, liens, fraudRiskScore } = CRS_SANDBOX_EXPECTED[testIdentityId]!;
      expect((await client.getPublicRecords(testIdentityId)).summary).toEqual({ bankruptcies, judgments, liens });
      expect((await client.getFraudRisk(testIdentityId)).summary).toEqual({ fraudRiskScore });
    }
    expect(CRS_SANDBOX_EXPECTED[7]).toMatchObject({ bankruptcies: 1 });
    expect(CRS_SANDBOX_EXPECTED[13]).toMatchObject({ fraudRiskScore: 88 });
  });

  it('agrees with the expected text CRS published for each persona', () => {
    for (const persona of CRS_CALHACKS_PERSONAS) {
      const expected = CRS_SANDBOX_EXPECTED[persona.testIdentityId]!;
      expect(persona.expectedFraudRisk).toMatch(new RegExp(`^risk\\.score ${expected.fraudRiskScore} `));
      expect(persona.expectedPublicRecords.includes('0/0/0')).toBe(expected.bankruptcies + expected.judgments + expected.liens === 0);
    }
  });

  it('answers only exact persona bodies, like the real sandbox', async () => {
    const response = await crsSandboxFixtureFetch('https://api-sandbox.stitchcredit.com/api/fraud-finder/fraud-finder', { method: 'POST', body: JSON.stringify({ email: 'someone@real.example' }) });
    expect(response.status).toBe(400);
  });
});

describe('createCrsClientFromEnv', () => {
  it('stays off without credentials and makes no call', () => {
    expect(createCrsClientFromEnv({})).toBeUndefined();
    expect(createCrsClientFromEnv({ CRS_USERNAME: ' ', CRS_PASSWORD: 'p' })).toBeUndefined();
  });

  it('builds a sandbox client that logs in with the given credentials', async () => {
    const network = vi.fn<typeof fetch>(crsSandboxFixtureFetch);
    const client = createCrsClientFromEnv({ CRS_USERNAME: 'user', CRS_PASSWORD: 'secret#1' }, network);
    expect((await client!.getPublicRecords(7)).summary).toEqual({ bankruptcies: 1, judgments: 0, liens: 0 });
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual({ username: 'user', password: 'secret#1' });
  });
});
