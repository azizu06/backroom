import type { HealthRow } from './health';

export interface DemoEnvironmentCheck {
  process: string;
  missing: string[];
  defaulted: string[];
}

const FULL_DEMO = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'NESSIE_API_KEY', 'NESSIE_ACCOUNT_ID',
  'CARTESIA_API_KEY', 'CARTESIA_WEBHOOK_SECRET', 'DEMO_PUBLIC_URL', 'APIFY_TOKEN',
  'GX10_BASE_URL', 'GX10_MODEL',
] as const;
const WEB = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'NESSIE_API_KEY', 'NESSIE_ACCOUNT_ID',
  'CARTESIA_API_KEY', 'DEMO_PUBLIC_URL', 'APIFY_TOKEN', 'GX10_BASE_URL', 'GX10_MODEL',
] as const;
const VOICE_SETUP = ['CARTESIA_API_KEY', 'CARTESIA_WEBHOOK_SECRET', 'DEMO_PUBLIC_URL'] as const;
const VOICE_RELAY = [...VOICE_SETUP, 'T1_DIAL_TO', 'T1_CONSENT_SOURCE', 'T1_CONSENT_TEXT', 'T1_CONSENT_AT'] as const;
const DEFAULT_WHEN_ABSENT = new Set(['ANTHROPIC_MODEL', 'GX10_BASE_URL', 'GX10_MODEL']);
const LIVE_MODE_VARIABLES = new Set(['PRECALL_APIFY', 'PRECALL_CRS', 'VENDOR_CRS']);

function configured(env: NodeJS.ProcessEnv, name: string) {
  return typeof env[name] === 'string' && env[name]!.trim().length > 0;
}

function defaultedNames(env: NodeJS.ProcessEnv) {
  return new Set((env.DEMO_ENV_DEFAULTED_NAMES || '').split(',').filter(Boolean));
}

function requirements(env: NodeJS.ProcessEnv, base: readonly string[]) {
  const names = [...base];
  if (env.DEMO_LIVE === '1') names.push('PRECALL_APIFY', 'PRECALL_CRS', 'VENDOR_CRS');
  if (env.PRECALL_CRS === 'live' || env.VENDOR_CRS === 'live') names.push('CRS_USERNAME', 'CRS_PASSWORD');
  return [...new Set(names)].sort();
}

function check(process: string, env: NodeJS.ProcessEnv, names: readonly string[]): DemoEnvironmentCheck {
  const markedDefaulted = defaultedNames(env);
  const missing: string[] = [], defaulted: string[] = [];
  for (const name of requirements(env, names)) {
    if (markedDefaulted.has(name) || (LIVE_MODE_VARIABLES.has(name) && env[name] !== 'live')
      || (!configured(env, name) && DEFAULT_WHEN_ABSENT.has(name))) defaulted.push(name);
    else if (!configured(env, name)) missing.push(name);
  }
  return { process, missing, defaulted };
}

/** Records only variable names. Values never enter status, health, or logs. */
export function markDemoEnvironmentDefaulted(env: NodeJS.ProcessEnv, name: string) {
  const names = defaultedNames(env); names.add(name);
  env.DEMO_ENV_DEFAULTED_NAMES = [...names].sort().join(',');
}

/** Every process launched by demo:up, with only the variables that process needs. */
export function demoEnvironmentChecks(env: NodeJS.ProcessEnv): DemoEnvironmentCheck[] {
  const rows: DemoEnvironmentCheck[] = [check('supervisor', env, FULL_DEMO)];
  if (env.STATE_STORE === 'spacetime' && env.DEMO_STATE_REMOTE !== '1') {
    const state = env.DEMO_SPACETIME === 'maincloud' ? ['SPACETIME_CONFIG'] : [];
    rows.push(check('SpacetimeDB', env, state));
  }
  if (env.DEMO_PREBUILT !== '1') rows.push(check('web build', env, WEB));
  if (env.DEMO_TUNNEL !== '0' && defaultedNames(env).has('DEMO_PUBLIC_URL')) rows.push(check('cloudflared tunnel', env, []));
  rows.push(check('attack demo', env, []));
  if (env.DEMO_VOICE === '1') {
    if (env.DEMO_VOICE_SETUP !== '0') rows.push(check('voice setup', env, VOICE_SETUP));
    rows.push(check('voice relay', env, VOICE_RELAY));
  }
  rows.push(check('web + seats', env, WEB));
  return rows;
}

export function formatEnvironmentCheck(row: DemoEnvironmentCheck) {
  const issues = [
    ...(row.missing.length ? [`missing ${row.missing.join(', ')}`] : []),
    ...(row.defaulted.length ? [`defaulted ${row.defaulted.join(', ')}`] : []),
  ];
  return `Environment ${row.process}: ${issues.length ? issues.join('; ') : 'ready'}`;
}

export function environmentHealthRow(process: string, env: NodeJS.ProcessEnv): HealthRow {
  const row = process === 'web + seats' ? check(process, env, WEB) : check(process, env, FULL_DEMO);
  const detail = [
    ...(row.missing.length ? [`missing: ${row.missing.join(', ')}`] : []),
    ...(row.defaulted.length ? [`defaulted: ${row.defaulted.join(', ')}`] : []),
  ].join('; ');
  return { name: `Required env (${process})`, ok: !detail, detail: detail || 'all required variables explicitly configured' };
}
