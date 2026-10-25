import { afterEach, expect, it, vi } from 'vitest';
import { runEmailDispatcher } from './email-dispatcher';
import { createRoleRegistry } from '../roles';

afterEach(() => vi.unstubAllGlobals());

it('C14 queues one safe simulated follow-up through the production Dispatcher and dedupes the second case', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher();
  expect(run.match).toBe(true);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
  expect(run.first.syntheticCostUsd).toBeGreaterThan(0); // synthetic SDK receipt, never paid spend
});

it('rejects an ambiguous planner/post-call registry instead of silently choosing a collections phase', () => {
  expect(() => createRoleRegistry({ collections: {} as never, collectionsPlanner: {} as never })).toThrow('COLLECTIONS_ROLE_AMBIGUOUS');
});

it.each([['no_consent', 'CONSENT_REQUIRED'], ['opt_out', 'DNC']] as const)('%s queues a policy-checked preview without a dial', async (mode, rule) => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher(mode);
  expect(run.first.status).toBe('done');
  expect(run.queuedPreviews).toBe(1);
  expect(run.providerRequests).toBe(0);
  expect(run.emailAudits[0]).toMatchObject({ action: 'email_followup_queued', decision: 'ALLOW', ruleIds: [rule] });
});

it.each([
  ['after_hours', 'DENY', 'CALL_WINDOW'], ['bankruptcy', 'ESCALATE', 'BANKRUPTCY_STOP'],
  ['ofac', 'ESCALATE', 'OFAC_STOP'], ['dispute', 'ESCALATE', 'DISPUTE_STOP'],
  ['closed', 'ESCALATE', 'CLOSED_BUSINESS_STOP'], ['no_address', 'DENY', 'NO_EMAIL_ON_FILE'],
] as const)('%s remains held and queues nothing', async (mode, decision, rule) => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher(mode);
  expect(run.first.status).toBe('held');
  expect(run.queuedPreviews).toBe(0);
  expect(run.providerRequests).toBe(0);
  expect(run.emailAudits[0]).toMatchObject({ action: 'email_followup_blocked', decision, ruleIds: [rule] });
});

it.each(['off', 'cancel', 'failed', 'no_port'] as const)('%s does not enqueue a fallback', async mode => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher(mode);
  expect(run.queuedPreviews).toBe(0);
  expect(run.providerRequests).toBe(0);
  expect(run.emailAudits).toEqual([]);
  expect(run.first.status).not.toBe('done');
  if (mode === 'off') expect(run.first).toMatchObject({ status: 'paused', roles: [], syntheticCostUsd: 0 });
});

it('does not send email after a permitted call was started', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher('callable');
  expect(run.first.status).toBe('done');
  expect(run.providerRequests).toBe(1); // injected CallStarter only; no provider HTTP
  expect(run.queuedPreviews).toBe(0);
  expect(run.emailAudits).toEqual([]);
});


it.each([
  'person@domain.example/private-fragment', 'person@domain.example?private-fragment',
  'person@domain.example#private-fragment', 'person@domain.example:443',
  'person@domain..example', 'person@-domain.example', 'person@domain.example\r\nBcc: private@other.example',
])('rejects malformed trusted email contact %s before it can enter the queue or audit domain', async address => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runEmailDispatcher('consumer', address);
  expect(run.first.status).toBe('held');
  expect(run.queuedPreviews).toBe(0);
  expect(run.providerRequests).toBe(0);
  expect(run.emailAudits[0]).toMatchObject({ action: 'email_followup_blocked', ruleIds: ['NO_EMAIL_ON_FILE'] });
  expect(run.emailAudits[0]!.inputs).not.toHaveProperty('toDomain');
  expect(JSON.stringify(run.emailAudits)).not.toContain('private');
});

it('normalizes only the trusted recipient hostname before queuing and auditing', async () => {
  const run = await runEmailDispatcher('consumer', ' Billing@Client.Example ');
  expect(run.first.status).toBe('done');
  expect(run.queuedPreviews).toBe(1);
  expect(run.emailAudits[0]!.inputs).toMatchObject({ toDomain: 'client.example' });
});
