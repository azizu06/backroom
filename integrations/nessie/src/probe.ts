import { readFile, writeFile } from 'node:fs/promises';
import { type Claims, type NessieClient, seedNorthfield } from './index.js';

/** Called only by live.ts --probe-variants; each mutation has a durable one-time claim. */
export async function probeVariants(client: NessieClient, claims: Claims, apiKey: string, destination: string) {
  const observations: unknown[] = JSON.parse(await readFile(destination, 'utf8').catch(() => '{"observations":[]}')).observations;
  function redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, /(^_id$|_id$|account_number)/.test(key) ? '<redacted>' : redact(item)]));
    if (typeof value === 'string') return value.replaceAll(apiKey, '<redacted>').replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, '<id>');
    return value;
  }
  async function request(method: string, path: string, body?: unknown) {
    const url = new URL(path, 'https://prod-api.nessieisreal.com'); url.searchParams.set('key', apiKey);
    const started = performance.now();
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    observations.push(redact({ method, path, body, status: response.status, elapsedMs: Math.round(performance.now() - started), response: data }));
    await writeFile(destination, JSON.stringify({ checkedAt: new Date().toISOString(), observations }, null, 2));
    return data;
  }
  const { customer, account } = await seedNorthfield(client, claims);
  const checkingPath = `/accounts/${account._id}`;
  // Existing completed deposits have aged since the first T4 attempt; read without changing them.
  await request('GET', checkingPath);
  await request('GET', `${checkingPath}/deposits`);
  const description = 'backroom:T4-status-variant-2026-10-24';
  let pending = (await client.listDeposits(account._id)).find(d => d.description === description);
  if (!pending && await claims.claim('T4:probe:pending-deposit')) {
    const created = await request('POST', `${checkingPath}/deposits`, { medium: 'balance', status: 'pending',
      transaction_date: '2026-10-24', amount: 3, description });
    pending = created.objectCreated ?? created;
  }
  await request('GET', checkingPath);
  if (pending?._id && await claims.claim('T4:probe:complete-deposit')) {
    await request('PUT', `/deposits/${pending._id}`, { status: 'completed' });
    await request('GET', `/deposits/${pending._id}`);
  }
  await request('GET', checkingPath);
  // Keep purchase/transfer probes on a separate funded sandbox account.
  const nickname = 'Northfield T4 Variant Source (Nessie = sandbox bank)';
  let source = (await client.listAccounts(customer._id)).find(a => a.nickname === nickname);
  if (!source && await claims.claim('T4:probe:source-account')) {
    const created = await request('POST', `/customers/${customer._id}/accounts`, { type: 'Checking', nickname, rewards: 0, balance: 100 });
    source = created.objectCreated ?? created;
  }
  if (!source?._id) throw new Error('Probe source account uncertain; do not retry creation');
  const sourcePath = `/accounts/${source._id}`;
  await request('GET', sourcePath);
  if (await claims.claim('T4:probe:transfer')) {
    await request('POST', `${sourcePath}/transfers`, { medium: 'balance', payee_id: account._id,
      amount: 1, transaction_date: '2026-10-24', status: 'completed', description: 'T4 transfer probe' });
  }
  await request('GET', sourcePath);
  await request('GET', checkingPath);
  const merchants = await request('GET', '/merchants');
  let merchant = merchants.find((m: { name: string }) => m.name === 'Northfield T4 Probe Merchant');
  if (!merchant && await claims.claim('T4:probe:merchant')) {
    const created = await request('POST', '/merchants', { name: 'Northfield T4 Probe Merchant' });
    merchant = created.objectCreated ?? created;
  }
  if (!merchant?._id) throw new Error('Probe merchant uncertain; do not retry creation');
  if (await claims.claim('T4:probe:purchase')) {
    await request('POST', `${sourcePath}/purchases`, { merchant_id: merchant._id, medium: 'balance',
      purchase_date: '2026-10-24', amount: 1, status: 'pending', description: 'T4 purchase probe' });
  }
  const purchases = await request('GET', `${sourcePath}/purchases`);
  const purchase = purchases.find((row: { description: string }) => row.description === 'T4 purchase probe');
  if (purchase?._id && await claims.claim('T4:probe:complete-purchase')) {
    await request('PUT', `/purchase/${purchase._id}`, { status: 'completed' });
    await request('GET', `/purchase/${purchase._id}`);
  }
  await request('GET', sourcePath);
  await request('GET', checkingPath);
  console.log(`Nessie = sandbox bank: status/transfer/purchase observations saved to ${destination}`);
}
