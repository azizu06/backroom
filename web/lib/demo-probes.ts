import { existsSync, statSync } from 'node:fs';
import { open, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ServiceId, StatusId } from './real-vs-sim';

/** Server-only: bounded, read-only evidence for the Real vs simulated panel. Never calls a model or writes anything. */
export type ProbeState = 'verified' | 'simulated' | 'unreachable' | 'unverified' | 'disabled';
export type ServiceProbe = { state: ProbeState; source: 'live' | 'receipt' | 'config'; evidence: string; at: string | null };
export type ProbeDeps = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  readText: (path: string) => Promise<string | null>;
  /** Reads at most the last `bytes` of a file; falls back to readText when absent. */
  readTail?: (path: string, bytes: number) => Promise<string | null>;
  listDir: (path: string) => Promise<string[]>;
  evidenceRoot: string | null;
  voiceEvidencePaths: string[];
};
export type DemoProbes = { checkedAt: string; services: Record<ServiceId, ServiceProbe> };

export const PROBE_TIMEOUT_MS = 2000;
export const PROBE_CACHE_TTL_MS = 45_000;
/** A snapshot older than this is never served; the caller waits (bounded) for a fresh run instead. */
export const PROBE_CACHE_MAX_AGE_MS = 2 * PROBE_CACHE_TTL_MS;
export const RECEIPT_MAX_AGE_MS = 72 * 3600_000;
const FIRST_RUN_WAIT_MS = 2500;
const GX10_DEFAULT_BASE_URL = 'http://100.117.44.20:11434/v1';
const FUTURE_SKEW_MS = 5 * 60_000;
const VOICE_TAIL_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
};
const iso = (ms: number) => new Date(ms).toISOString();
const timeOf = (at: unknown) => typeof at === 'string' ? Date.parse(at) : Number.NaN;

function receiptMaxAge(env: ProbeDeps['env']) {
  const hours = Number(env.DEMO_RECEIPT_MAX_AGE_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * 3600_000 : RECEIPT_MAX_AGE_MS;
}
function isFresh(at: unknown, deps: ProbeDeps) {
  const t = timeOf(at);
  if (!Number.isFinite(t)) return false;
  const now = deps.now();
  return now - t <= receiptMaxAge(deps.env) && t - now <= FUTURE_SKEW_MS;
}
const unverified = (evidence: string, source: ServiceProbe['source'] = 'receipt'): ServiceProbe => ({ state: 'unverified', source, evidence, at: null });

async function httpProbe(deps: ProbeDeps, url: string, accept: (response: Response) => Promise<string | null>): Promise<ServiceProbe> {
  try {
    const response = await deps.fetch(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const at = iso(deps.now());
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { state: 'unreachable', source: 'live', evidence: `HTTP ${response.status}`, at };
    }
    const evidence = await accept(response);
    return evidence === null
      ? { state: 'unreachable', source: 'live', evidence: 'Unexpected response', at }
      : { state: 'verified', source: 'live', evidence, at };
  } catch (error) {
    const name = error instanceof Error || error instanceof DOMException ? error.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return { state: 'unreachable', source: 'live', evidence: timedOut ? 'Timed out' : 'Connection failed', at: iso(deps.now()) };
  }
}

async function probeGx10(deps: ProbeDeps): Promise<ServiceProbe> {
  if (deps.env.GX10_ENABLED === 'false') return { state: 'disabled', source: 'config', evidence: 'Disabled by config', at: null };
  // Same default as the model router (orchestrator/src/router/index.ts), so the panel probes what the router uses.
  const base = (deps.env.GX10_BASE_URL?.trim() || GX10_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return httpProbe(deps, `${base}/models`, async response => {
    const body: unknown = await response.json().catch(() => null);
    return isObject(body) && Array.isArray(body.data) ? `GET /models · ${body.data.length} models` : null;
  });
}

async function probeClaude(deps: ProbeDeps): Promise<ServiceProbe> {
  if ((deps.env.LLM_CLOUD_PROVIDER ?? 'anthropic') !== 'anthropic') return unverified('Cloud route is not direct Anthropic', 'config');
  if (!deps.env.ANTHROPIC_API_KEY?.trim()) return unverified('No cloud credential in this process', 'config');
  if (!deps.evidenceRoot) return unverified('No fresh route receipt');
  const dir = join(deps.evidenceRoot, 'anthropic');
  const files = (await deps.listDir(dir)).filter(name => /^live-.*\.json$/.test(name));
  let best: { at: string; requestId: string } | null = null;
  for (const name of files) {
    const receipt = parseJson(await deps.readText(join(dir, name)));
    if (!isObject(receipt) || receipt.passed !== true || receipt.provider !== 'anthropic' || !Array.isArray(receipt.requests)) continue;
    const ok = receipt.requests.find((request): request is Json => isObject(request) && request.status === 200
      && typeof request.requestId === 'string' && SAFE_ID.test(request.requestId));
    const at = receipt.startedAt;
    if (!ok || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
    if (!best || Date.parse(at) > Date.parse(best.at)) best = { at, requestId: ok.requestId as string };
  }
  if (!best || !isFresh(best.at, deps)) return unverified('No fresh route receipt');
  return { state: 'verified', source: 'receipt', evidence: `Route receipt ${best.requestId}`, at: best.at };
}

async function probeApify(deps: ProbeDeps): Promise<ServiceProbe> {
  const missing = unverified('No fresh run receipt');
  if (!deps.evidenceRoot) return missing;
  const root = deps.evidenceRoot;
  // The Apify evidence dir plus any rehearsal folder that saved a separate apify-live.json (e.g. test-v1).
  const candidates = [join(root, 'apify', 'live-run.json'), ...(await deps.listDir(root)).map(dir => join(root, dir, 'apify-live.json'))];
  let best: { at: string; runId: string } | null = null;
  for (const path of candidates) {
    const run = parseJson(await deps.readText(path));
    if (!isObject(run) || run.status !== 'complete' || run.chainValid === false) continue;
    if ('platform' in run && (!isObject(run.platform) || run.platform.status !== 'SUCCEEDED')) continue;
    const { runId, measuredAt: at } = run;
    if (typeof runId !== 'string' || !SAFE_ID.test(runId) || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
    if (!best || Date.parse(at) > Date.parse(best.at)) best = { at, runId };
  }
  if (!best || !isFresh(best.at, deps)) return missing;
  return { state: 'verified', source: 'receipt', evidence: `Run ${best.runId}`, at: best.at };
}

const firstRule = (decision: Json) => Array.isArray(decision.rule_ids) && typeof decision.rule_ids[0] === 'string'
  && /^[A-Z0-9_]{1,64}$/.test(decision.rule_ids[0]) ? decision.rule_ids[0] : null;

async function probePolicy(deps: ProbeDeps): Promise<ServiceProbe> {
  const missing = unverified('No fresh policy receipt');
  if (!deps.evidenceRoot) return missing;
  const root = join(deps.evidenceRoot, 'live-run');
  let best: { at: string; deny: string; allow: string } | null = null;
  for (const dir of await deps.listDir(root)) {
    const receipt = parseJson(await deps.readText(join(root, dir, 'receipt.json')));
    if (!isObject(receipt) || !isObject(receipt.collection)) continue;
    const { denial, allowed } = receipt.collection;
    if (!isObject(denial) || denial.kind !== 'DENY' || typeof denial.audit_id !== 'string' || !denial.audit_id) continue;
    if (!isObject(allowed) || allowed.kind !== 'ALLOW') continue;
    const deny = firstRule(denial), allow = firstRule(allowed), at = receipt.measuredAt;
    if (!deny || !allow || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
    if (!best || Date.parse(at) > Date.parse(best.at)) best = { at, deny, allow };
  }
  if (!best || !isFresh(best.at, deps)) return missing;
  return { state: 'verified', source: 'receipt', evidence: `Receipt: DENY ${best.deny}, ALLOW ${best.allow}`, at: best.at };
}

async function probePhone(deps: ProbeDeps): Promise<ServiceProbe> {
  let best: { at: string; status: number } | null = null;
  for (const path of deps.voiceEvidencePaths) {
    const text = await (deps.readTail ? deps.readTail(path, VOICE_TAIL_BYTES) : deps.readText(path));
    if (!text) continue;
    for (const line of text.slice(-VOICE_TAIL_BYTES).split('\n')) {
      const entry = parseJson(line.trim() || null);
      if (!isObject(entry) || typeof entry.path !== 'string' || !entry.path.startsWith('/api/voice/')) continue;
      const { status, at } = entry;
      if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 299) continue;
      if (typeof at !== 'string' || !isFresh(at, deps)) continue;
      if (!best || Date.parse(at) > Date.parse(best.at)) best = { at, status };
    }
  }
  if (!best) return unverified('No call receipt in this process');
  return { state: 'verified', source: 'receipt', evidence: `Call webhook HTTP ${best.status}`, at: best.at };
}

async function probeSpacetime(deps: ProbeDeps): Promise<ServiceProbe> {
  if ((deps.env.STATE_STORE ?? 'memory') !== 'spacetime') return { state: 'simulated', source: 'config', evidence: 'In-memory state', at: null };
  const uri = deps.env.SPACETIMEDB_URI?.trim(), db = deps.env.SPACETIMEDB_DATABASE?.trim();
  if (!uri || !db) return unverified('Not configured', 'config');
  const http = uri.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://').replace(/\/+$/, '');
  return httpProbe(deps, `${http}/v1/database/${encodeURIComponent(db)}`, async response => {
    await response.body?.cancel().catch(() => undefined);
    return 'Database reachable';
  });
}

const probes: Record<ServiceId, { run: (deps: ProbeDeps) => Promise<ServiceProbe>; live: boolean }> = {
  phone: { run: probePhone, live: false },
  claude: { run: probeClaude, live: false },
  gx10: { run: probeGx10, live: true },
  apify: { run: probeApify, live: false },
  policy: { run: probePolicy, live: false },
  spacetime: { run: probeSpacetime, live: true },
};

export async function probeServices(deps: ProbeDeps): Promise<Record<ServiceId, ServiceProbe>> {
  const ids = Object.keys(probes) as ServiceId[];
  const settled = await Promise.allSettled(ids.map(id => Promise.resolve().then(() => probes[id].run(deps))));
  const failedAt = () => { try { return iso(deps.now()); } catch { return null; } };
  return Object.fromEntries(ids.map((id, index) => {
    const result = settled[index];
    if (result?.status === 'fulfilled') return [id, result.value];
    return [id, probes[id].live
      ? { state: 'unreachable', source: 'live', evidence: 'Probe failed', at: failedAt() }
      : unverified('Probe failed')];
  })) as Record<ServiceId, ServiceProbe>;
}

/** Bounded read: never loads more than `bytes` of an append-only log, and drops a partial first line. */
async function readTail(path: string, bytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function findEvidenceRoot(start: string) {
  let dir = start;
  for (let level = 0; level < 4; level += 1) {
    const candidate = join(dir, 'docs', 'evidence');
    try { if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate; } catch { /* keep searching */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveDeps(overrides: Partial<ProbeDeps>): ProbeDeps {
  const env = overrides.env ?? process.env;
  const needsSearch = !('evidenceRoot' in overrides && 'voiceEvidencePaths' in overrides);
  const cwd = process.cwd();
  const found = needsSearch ? findEvidenceRoot(cwd) : null;
  const evidenceRoot = 'evidenceRoot' in overrides ? overrides.evidenceRoot ?? null : env.DEMO_EVIDENCE_DIR || found;
  const repoRoots = found ? [dirname(dirname(found))] : [cwd, dirname(cwd)];
  const voiceEvidencePaths = overrides.voiceEvidencePaths ?? (env.VOICE_EVIDENCE_FILE
    ? [env.VOICE_EVIDENCE_FILE]
    : repoRoots.flatMap(root => [join(root, '.env.voice', 'http-evidence.jsonl'), join(root, 'orchestrator', '.env.voice', 'http-evidence.jsonl')]));
  return {
    env,
    fetch: overrides.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: overrides.now ?? Date.now,
    readText: overrides.readText ?? (path => readFile(path, 'utf8').catch(() => null)),
    readTail: overrides.readTail ?? (overrides.readText ? undefined : readTail),
    listDir: overrides.listDir ?? (path => readdir(path).catch(() => [])),
    evidenceRoot,
    voiceEvidencePaths,
  };
}

let cache: { value: DemoProbes; at: number } | null = null;
let inflight: Promise<DemoProbes | null> | null = null;
let generation = 0;

function refresh(deps: ProbeDeps): Promise<DemoProbes | null> {
  if (inflight) return inflight;
  const run = generation;
  const promise = (async () => {
    const services = await probeServices(deps);
    const at = deps.now();
    const value: DemoProbes = { checkedAt: iso(at), services };
    if (run === generation) cache = { value, at };
    return value;
  })().catch(() => null).finally(() => { if (inflight === promise) inflight = null; });
  inflight = promise;
  return promise;
}

/** Cached, stale-while-revalidate probe snapshot. Never throws; null while the first run is still pending. */
export async function getDemoProbes(overrides: Partial<ProbeDeps> = {}): Promise<DemoProbes | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deps = resolveDeps(overrides);
    if (cache) {
      const age = deps.now() - cache.at;
      if (age <= PROBE_CACHE_TTL_MS) return cache.value;
      if (age <= PROBE_CACHE_MAX_AGE_MS) { void refresh(deps); return cache.value; }
    }
    const pending = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), FIRST_RUN_WAIT_MS); });
    return await Promise.race([refresh(deps), pending]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function resetDemoProbesForTest() {
  generation += 1;
  cache = null;
  inflight = null;
}

export type ServiceStatusSnapshot = { checkedAt: string; services: Partial<Record<StatusId, ServiceProbe>> };
export type ServiceStatusSource = { name: string; read(): Promise<ServiceStatusSnapshot | null> };

export const localProbeSource: ServiceStatusSource = { name: 'local-probes', read: () => getDemoProbes() };
let currentSource: ServiceStatusSource = localProbeSource;

/** Swap in a host service-status contract later without touching the route or panel. null restores local probes. */
export function setServiceStatusSource(source: ServiceStatusSource | null) {
  currentSource = source ?? localProbeSource;
}

export async function readServiceStatus(): Promise<ServiceStatusSnapshot | null> {
  try {
    return (await currentSource.read()) ?? null;
  } catch {
    return null;
  }
}
