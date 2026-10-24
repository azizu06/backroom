import { describe, expect, it, vi } from 'vitest';
import { CrsClient } from './index';

describe('CRS authentication (public OpenAPI UserLoginRespDTO)', () => {
  it('shares a login across concurrent callers and never returns credentials', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ token: 'secret', refreshToken: 'refresh' })));
    const client = new CrsClient({ username: 'user', password: 'password', fetch: network });
    expect(await Promise.all([client.login(), client.login()])).toEqual([undefined, undefined]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual({ username: 'user', password: 'password' });
  });
});

// Product responses below are synthetic adapter contracts, NOT vendor examples.
const identity = { testIdentityId: 1, source: 'CRS booth test data', businessCredit: { businessId: 'SANDBOX-ONLY' }, ofac: { businessId: 'SANDBOX-ONLY' } };
const products = {
  businessCredit: { path: '/test/business', summarize: () => ({ creditScore: 72 }) },
  ofac: { path: '/test/ofac', summarize: (body: Record<string, unknown>) => ({ ofacStatus: body.match === true ? 'hit' as const : body.match === false ? 'clear' as const : 'unknown' as const }) },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('refreshes once after an expired token and returns only labeled summary plus hash', async () => {
  const network = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(json({ token: 'old', refreshToken: 'refresh' }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ token: 'new', refreshToken: 'next' }))
    .mockResolvedValueOnce(json({ match: true, ssn: 'never persist this' }));
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [identity], products });
  const result = await client.checkOfac(1);
  expect(result).toMatchObject({ label: 'SANDBOX: test identity #1', summary: { ofacStatus: 'hit' }, source: 'crs_sandbox', product: 'ofac' });
  expect(result.responseHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain('never persist');
  expect(network.mock.calls[2]?.[0]).toBe('https://api-sandbox.stitchcredit.com/api/users/refresh-token');
  expect(JSON.parse(String(network.mock.calls[2]?.[1]?.body))).toEqual({ refreshToken: 'refresh' });
  expect(network.mock.calls[3]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer new' });
});

it('blocks missing adapters and unapproved identities before authentication', async () => {
  const network = vi.fn<typeof fetch>();
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [identity], products });
  await expect(client.checkOfac(99)).rejects.toMatchObject({ code: 'CONFIGURATION' });
  await expect(new CrsClient({ username: 'u', password: 'p', fetch: network }).getBusinessCreditReport(1)).rejects.toMatchObject({ code: 'CONFIGURATION' });
  expect(network).not.toHaveBeenCalled();
});

it('latches failed login without leaking the provider error or retrying the account', async () => {
  const network = vi.fn<typeof fetch>().mockResolvedValue(json({ password: 'sensitive' }, 401));
  const client = new CrsClient({ username: 'u', password: 'sensitive', fetch: network });
  await expect(client.login()).rejects.toThrow('CRS AUTH (401)');
  await expect(client.login()).rejects.toThrow('CRS AUTH');
  expect(network).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(client)).not.toContain('sensitive');
});

it.each([
  ['clear', { match: false }, { ofacStatus: 'clear' }],
  ['unknown', { unexpected: true }, { ofacStatus: 'unknown' }],
])('does not confuse OFAC %s with a hit', async (_name, body, summary) => {
  const network = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(json(body));
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [identity], products });
  expect((await client.checkOfac(1)).summary).toEqual(summary);
});

it('projects business credit fields, snapshots approved test inputs and does not return raw PII', async () => {
  const network = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(json({ name: 'PII', score: 72 }));
  const input = structuredClone(identity);
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [input], products });
  input.businessCredit.businessId = 'REAL-INPUT';
  const result = await client.getBusinessCreditReport(1);
  expect(result.summary).toEqual({ creditScore: 72 });
  expect(JSON.parse(String(network.mock.calls[1]?.[1]?.body))).toEqual({ businessId: 'SANDBOX-ONLY' });
  expect(JSON.stringify(result)).not.toContain('PII');
});

it.each([
  ['HTTP 200 product error', () => json({ errorMessages: ['provider PII error'] })],
  ['invalid JSON', () => new Response('provider PII error')],
  ['upstream error', () => json({ error: 'provider PII error' }, 503)],
])('rejects %s without retaining the response', async (_name, response) => {
  const network = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(response());
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [identity], products });
  await expect(client.checkOfac(1)).rejects.toThrow(/^CRS (HTTP|RESPONSE)/);
  expect(network).toHaveBeenCalledTimes(2);
});

it('coalesces refresh for simultaneous expired requests and bounds each product retry', async () => {
  let logins = 0, refreshes = 0;
  const network = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/users/login')) { logins++; return json({ token: 'old', refreshToken: 'refresh' }); }
    if (String(url).endsWith('/users/refresh-token')) { refreshes++; return json({ token: 'new' }); }
    if ((init?.headers as Record<string, string>).Authorization === 'Bearer old') return json({}, 401);
    return json({}, 401);
  });
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network, identities: [identity], products });
  const results = await Promise.allSettled([client.checkOfac(1), client.checkOfac(1)]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(logins).toBe(1);
  expect(refreshes).toBe(1);
  expect(network).toHaveBeenCalledTimes(6);
});

it('does not follow redirects or reveal network errors', async () => {
  const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('PII inside URL'));
  const client = new CrsClient({ username: 'u', password: 'p', fetch: network });
  await expect(client.login()).rejects.toThrow('CRS AUTH');
  expect(network.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
});

it('refuses blank credentials without risking an account login', async () => {
  const network = vi.fn<typeof fetch>();
  await expect(new CrsClient({ username: ' ', password: '', fetch: network }).login()).rejects.toMatchObject({ code: 'CONFIGURATION' });
  expect(network).not.toHaveBeenCalled();
});
