import { getDemoHostServices } from './demo/services';
import { localProbeSource, RECEIPT_MAX_AGE_MS, type ServiceProbe, type ServiceStatusSnapshot, type ServiceStatusSource } from './demo-probes';
import type { DemoStatus } from '../../tools/demo/health';

/** Services whose status comes from the web host contract (#117) when one is installed. */
export const hostServiceIds = ['claude', 'apify', 'nessie', 'crs'] as const;
export type HostServices = NonNullable<DemoStatus['services']>;
type HostDeps = { readHost: () => HostServices | null | undefined; local: ServiceStatusSource; now: () => number; hostStartedAt: () => number };

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const probe = (state: ServiceProbe['state'], source: ServiceProbe['source'], evidence: string, at: string | null = null): ServiceProbe => ({ state, source, evidence, at });

const FUTURE_SKEW_MS = 5 * 60_000;

/** Verified only from a sandbox response or reconciled deposit this host observed, dated by that observation. */
function nessieProbe(nessie: HostServices['nessie'], now: number): ServiceProbe {
  const failed = Date.parse(nessie.unreachableAt ?? '');
  if (Number.isFinite(failed)) return probe('unreachable', 'receipt', 'Sandbox read failed', new Date(failed).toISOString());
  const { proof } = nessie;
  if (!proof) return probe('unverified', 'receipt', 'No sandbox read or reconciled deposit in this host yet');
  const at = Date.parse(proof.at);
  if (!Number.isFinite(at) || now - at > RECEIPT_MAX_AGE_MS || at - now > FUTURE_SKEW_MS) return probe('unverified', 'receipt', 'Bank evidence not fresh');
  const since = new Date(at).toISOString();
  if (proof.kind === 'deposit_exact_match') {
    const ref = typeof proof.depositId === 'string' && SAFE_ID.test(proof.depositId) ? `Deposit ${proof.depositId}` : 'Sandbox deposit';
    return probe('verified', 'receipt', `${ref} reconciled · EXACT_PAYMENT_MATCH`, since);
  }
  return proof.kind === 'sandbox_read' ? probe('verified', 'receipt', 'Test bank account read (read only)', since)
    : probe('unverified', 'receipt', 'Unrecognized bank evidence');
}

/**
 * Maps the host's passive observations to panel probes. Apify, CRS and model status carry no timestamps, so their
 * Verified claim is dated at host process start: never later than the evidence, so its age is never understated.
 * Nessie evidence carries its own observation time.
 */
export function mapHostServices(host: HostServices, now: number, hostStartedAt: number): Record<(typeof hostServiceIds)[number], ServiceProbe> {
  const fresh = now - hostStartedAt <= RECEIPT_MAX_AGE_MS && hostStartedAt <= now;
  const since = new Date(hostStartedAt).toISOString();
  const verified = (evidence: string) => fresh ? probe('verified', 'receipt', evidence, since) : probe('unverified', 'receipt', 'Host evidence too old');
  const live = host.model.mode !== 'OFF';

  const claude = !live ? probe('disabled', 'config', 'Rehearsal host: live model routing off')
    : host.model.cloud === 'inference_observed' ? verified('Host pre-call inference validated')
    : host.model.cloud === 'configured_not_probed' ? probe('unverified', 'config', 'Configured in host; inference not observed')
    : probe('unverified', 'config', 'No cloud credential in host');

  const { apify: a } = host;
  const apify = a.mode !== 'live' ? probe('simulated', 'config', 'FAKE rehearsal adapter')
    : a.status === 'complete' && typeof a.runId === 'string' && SAFE_ID.test(a.runId) ? verified(`Run ${a.runId}`)
    : a.status === 'pending' ? probe('unverified', 'receipt', 'Run started; completion not observed')
    : a.status === 'unavailable_no_retry' ? probe('unreachable', 'receipt', 'Run unavailable; no retry this host')
    : probe('unverified', 'receipt', 'No run in this host yet');

  const nessie = host.nessie.mode === 'sandbox' ? nessieProbe(host.nessie, now) : probe('simulated', 'config', 'Mock Nessie HTTP transport');

  const { crs: c } = host;
  const crs = c.mode !== 'sandbox' ? probe('simulated', 'config', 'FAKE fixture client')
    : c.status === 'complete' ? verified('Partner test records + fraud risk')
    : c.status === 'unavailable' ? probe('unreachable', 'receipt', 'Sandbox check unavailable')
    : probe('unverified', 'receipt', 'No sandbox check in this host yet');

  return { claude, apify, nessie, crs };
}

/** Host contract for model/cloud, Apify, Nessie and CRS; local probes keep GX10, SpacetimeDB, phone and policy. */
export function createHostServiceSource(deps: HostDeps): ServiceStatusSource {
  return {
    name: 'demo-host+local-probes',
    async read(): Promise<ServiceStatusSnapshot | null> {
      const local = await deps.local.read();
      let host: HostServices | null | undefined;
      try { host = deps.readHost(); } catch { host = null; }
      // No host contract (plain next dev) or first local run still pending: keep the local behavior unchanged.
      if (!host || !local) return local;
      const services = { ...local.services };
      delete services.claude; delete services.apify;
      return { checkedAt: local.checkedAt, services: { ...services, ...mapHostServices(host, deps.now(), deps.hostStartedAt()) } };
    },
  };
}

export const hostServiceSource = createHostServiceSource({
  readHost: getDemoHostServices,
  local: localProbeSource,
  now: Date.now,
  hostStartedAt: () => Date.now() - process.uptime() * 1000,
});
