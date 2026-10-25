import { expect, it } from 'vitest';
import { demoEnvironmentChecks, environmentHealthRow } from '../../tools/demo/env';

const complete: NodeJS.ProcessEnv = {
  DEMO_LIVE: '1',
  DEMO_VOICE: '1',
  PRECALL_APIFY: 'live',
  PRECALL_CRS: 'live',
  VENDOR_CRS: 'live',
  ANTHROPIC_API_KEY: 'dummy-anthropic',
  ANTHROPIC_MODEL: 'dummy-model',
  CRS_USERNAME: 'dummy-crs-user',
  CRS_PASSWORD: 'dummy-crs-password',
  NESSIE_API_KEY: 'dummy-nessie',
  NESSIE_ACCOUNT_ID: 'dummy-account',
  CARTESIA_API_KEY: 'dummy-cartesia',
  CARTESIA_WEBHOOK_SECRET: 'dummy-webhook',
  DEMO_PUBLIC_URL: 'https://demo.example.test',
  APIFY_TOKEN: 'dummy-apify',
  GX10_BASE_URL: 'http://127.0.0.1:11434/v1',
  GX10_MODEL: 'dummy-local-model',
  T1_DIAL_TO: '+15555550100',
  T1_CONSENT_SOURCE: 'synthetic-test',
  T1_CONSENT_TEXT: 'synthetic consent',
  T1_CONSENT_AT: '2026-10-24T00:00:00Z',
  STATE_STORE: 'memory',
  DEMO_PREBUILT: '1',
  DEMO_TUNNEL: '0',
};

it('reports required names by demo process without exposing values', () => {
  const env = { ...complete };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  delete env.CRS_PASSWORD;
  delete env.GX10_BASE_URL;
  env.PRECALL_CRS = 'live';
  env.VENDOR_CRS = 'fake';
  env.DEMO_ENV_DEFAULTED_NAMES = 'DEMO_PUBLIC_URL,CARTESIA_WEBHOOK_SECRET';

  const checks = demoEnvironmentChecks(env);
  const supervisor = checks.find(row => row.process === 'supervisor')!;
  const web = checks.find(row => row.process === 'web + seats')!;
  const voice = checks.find(row => row.process === 'voice relay')!;
  expect(supervisor.missing).toEqual(expect.arrayContaining(['ANTHROPIC_API_KEY', 'CRS_PASSWORD']));
  expect(supervisor.defaulted).toEqual(expect.arrayContaining(['ANTHROPIC_MODEL', 'GX10_BASE_URL', 'DEMO_PUBLIC_URL', 'CARTESIA_WEBHOOK_SECRET', 'VENDOR_CRS']));
  expect(web.missing).toContain('ANTHROPIC_API_KEY');
  expect(voice.defaulted).toContain('CARTESIA_WEBHOOK_SECRET');
  expect(JSON.stringify(checks)).not.toContain('dummy-');
  expect(JSON.stringify(checks)).not.toContain('+1555');
});

it('health is red and names only missing/defaulted web requirements', () => {
  const env: NodeJS.ProcessEnv = { ...complete, DEMO_ENV_DEFAULTED_NAMES: 'DEMO_PUBLIC_URL' };
  delete env.APIFY_TOKEN;
  const row = environmentHealthRow('web + seats', env);
  expect(row).toEqual({
    name: 'Required env (web + seats)',
    ok: false,
    detail: 'missing: APIFY_TOKEN; defaulted: DEMO_PUBLIC_URL',
  });
});

it('reports ready when every required name is explicitly configured', () => {
  expect(demoEnvironmentChecks(complete).every(row => row.missing.length === 0 && row.defaulted.length === 0)).toBe(true);
  expect(environmentHealthRow('web + seats', complete)).toEqual({
    name: 'Required env (web + seats)', ok: true, detail: 'all required variables explicitly configured',
  });
});
