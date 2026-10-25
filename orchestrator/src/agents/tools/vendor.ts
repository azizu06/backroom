/**
 * Vendor verifier tools. One responsibility: gather trusted evidence about the vendor behind a case
 * and decide whether Payables may proceed. Every tool is read-only: nothing here writes the vendor
 * master, creates an approval or authorizes money. The model picks which check to run; code derives
 * identity, vendor, domains and thresholds from the activation, and code decides the verdict.
 */
import { z } from 'zod';
import { CRS_FRAUD_RISK_THRESHOLD, DEFAULT_POLICY, evaluate, type Decision } from '@backroom/policy';
import type { BankChangeRisk } from '../../vendor/crs';
import { assessBankChangeRisk } from '../../vendor/crs';
import { boundedHealthCheck } from '../../collections/checks';
import type { HealthCheck, PublicCompany } from '../../collections/types';
import type { ApprovedVendor, FinanceRepository } from '../../payables/types';
import { domain as normalize, validDomain } from '../../payables/decisions';
import type { DomainTool, HandoffRequest, Json, ToolContext } from '../contracts';
import { ApifyBudget, CONTACT_CAP_USD, projectContactItems, siteCorroboratesDomain, type ContactRunner } from './vendor-apify';

export type VendorOutcome = 'proceed' | 'return_to_extractor' | 'human_review';
export type EvidenceKind = 'vendor_master' | 'domain_sender' | 'domain_claimed' | 'business' | 'site_health' | 'contact_page' | 'verdict';
/** `pending` = Apify/CRS did not answer in time; `unavailable` = answered unusably or not configured. Neither is evidence. */
export type EvidenceStatus = 'ok' | 'pending' | 'unavailable' | 'skipped_budget';

/** Facts about the case, loaded server-side from the activation's artifact refs. */
export interface VendorCase {
  vendorId: string;
  kind: 'invoice' | 'bank_change' | 'vendor';
  /** Trusted envelope metadata. */
  senderDomain: string;
  /** Extracted from the document; checked, never trusted. */
  claimedDomain?: string;
  /** Extracted; compared in code against the master and never shown to the model. */
  claimedAccountId?: string;
}
export interface EvidenceRecord { ref: string; kind: EvidenceKind; status: EvidenceStatus; facts: { [key: string]: Json }; ruleIds: string[]; at: number }
export interface VendorEvidenceStore {
  /** First write for (activation, kind) wins; repeats return the stored record so paid checks never rerun. */
  put(activation: ToolContext['activation'], record: Omit<EvidenceRecord, 'ref'>): Promise<EvidenceRecord>;
  list(activation: ToolContext['activation']): Promise<EvidenceRecord[]>;
  /** Cross-activation lookup for handoff validation. */
  get(ref: string): Promise<EvidenceRecord | undefined>;
}
export class MemoryVendorEvidenceStore implements VendorEvidenceStore {
  private rows = new Map<string, EvidenceRecord>();
  async put(activation: ToolContext['activation'], record: Omit<EvidenceRecord, 'ref'>) {
    const ref = `vendor-evidence:${activation.caseId}:${activation.activationId}:${record.kind}`;
    const existing = this.rows.get(ref);
    if (existing) return structuredClone(existing);
    const row = { ...structuredClone(record), ref };
    this.rows.set(ref, row);
    return structuredClone(row);
  }
  async list(activation: ToolContext['activation']) {
    const prefix = `vendor-evidence:${activation.caseId}:${activation.activationId}:`;
    return [...this.rows.values()].filter(row => row.ref.startsWith(prefix)).map(row => structuredClone(row));
  }
  async get(ref: string) { return structuredClone(this.rows.get(ref)); }
}

export interface VendorToolDeps {
  /** Resolves the case from the activation's artifact refs in trusted state; never from model args. */
  loadCase(activation: ToolContext['activation']): Promise<VendorCase>;
  vendors: Pick<FinanceRepository, 'getVendor' | 'hasPendingBankChange'>;
  /** CRS Fraud Finder. Same adapter the existing VendorSeat uses (mapped identity only). */
  bankChangeRisk: BankChangeRisk;
  /** PitchPoint public records for the mapped identity, or undefined when no identity is mapped. */
  publicRecords(vendorId: string): Promise<{ bankruptcies: number; evidenceRef: string } | undefined>;
  health: HealthCheck;
  contact: ContactRunner;
  budget: ApifyBudget;
  evidence: VendorEvidenceStore;
  /** Trusted public identity for the website Actor; defaults to the vendor id and master domain. */
  companyFor?(vendorId: string, master: ApprovedVendor): PublicCompany;
  now?: () => number;
}

const NONE = z.object({}).strict();
const DEADLINE_MS = 40_000;

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, ms = DEADLINE_MS): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)).then(value => ({ ok: true as const, value }), () => ({ ok: false as const, timedOut: false })),
      new Promise<{ ok: false; timedOut: true }>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ ok: false, timedOut: true }); }, ms); }),
    ]);
  } finally { clearTimeout(timer); parent.removeEventListener('abort', abort); }
}

const publicView = (row: EvidenceRecord) => ({ ref: row.ref, status: row.status, ruleIds: row.ruleIds, ...row.facts });

export function createVendorTools(deps: VendorToolDeps, options: { deadlineMs?: number } = {}): readonly DomainTool<any, Json>[] {
  const now = deps.now ?? Date.now;
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  const record = (ctx: ToolContext, kind: EvidenceKind, status: EvidenceStatus, facts: { [key: string]: Json }, ruleIds: string[] = []) =>
    deps.evidence.put(ctx.activation, { kind, status, facts, ruleIds, at: now() });
  async function master(ctx: ToolContext) {
    const c = await deps.loadCase(ctx.activation);
    return { c, vendor: await deps.vendors.getVendor(c.vendorId) };
  }

  const getVendorMaster: DomainTool<z.infer<typeof NONE>, Json> = {
    name: 'get_vendor_master',
    description: 'Read the approved vendor master record for the vendor in this case. Returns whether the payee is approved, its known domain, and whether the bank account on the document matches the account on file (a yes/no, never the account number). Read-only.',
    input: NONE,
    async execute(ctx) {
      await ctx.assertCurrent();
      const { c, vendor } = await master(ctx);
      const pending = vendor ? await deps.vendors.hasPendingBankChange(vendor.id) : false;
      const inMaster = !!vendor && vendor.inMaster !== false;
      const accountMatches = vendor && c.claimedAccountId !== undefined ? c.claimedAccountId === vendor.accountId : null;
      const ruleIds = !vendor || !inMaster || !vendor.approved ? ['PAYEE_NOT_IN_MASTER'] : [];
      if (vendor?.ofacHit) ruleIds.push('OFAC_STOP');
      await ctx.assertCurrent();
      return publicView(await record(ctx, 'vendor_master', 'ok', {
        found: !!vendor, inMaster, approved: vendor?.approved === true, knownDomain: vendor?.domain ?? null,
        accountMatchesDocument: accountMatches, pendingBankChange: pending, ofacFlaggedInMaster: vendor?.ofacHit === true,
        revision: vendor?.revision ?? null, caseKind: c.kind,
      }, ruleIds));
    },
  };

  const checkDomain: DomainTool<{ which: 'sender' | 'claimed' }, Json> = {
    name: 'check_domain',
    description: 'Compare the sender domain (from the email envelope) or the domain claimed on the document against the known domain in the vendor master. Returns exact, lookalike, different, missing or invalid. The domains come from the case, not from you.',
    input: z.object({ which: z.enum(['sender', 'claimed']) }).strict(),
    async execute(ctx, input) {
      await ctx.assertCurrent();
      const { c, vendor } = await master(ctx);
      const raw = input.which === 'sender' ? c.senderDomain : c.claimedDomain;
      let relation: 'exact' | 'lookalike' | 'different' | 'missing' | 'invalid' | 'no_master';
      const ruleIds: string[] = [];
      if (raw === undefined || raw === '') relation = 'missing';
      else if (!validDomain(raw)) relation = 'invalid';
      else if (!vendor || !validDomain(vendor.domain)) relation = 'no_master';
      else if (normalize(raw) === normalize(vendor.domain)) relation = 'exact';
      else {
        // The policy package owns the lookalike rule; use it rather than a second distance function.
        const decision = evaluate('vendor_onboarding', { type: 'propose_bank_change', emailDomain: raw }, {
          vendor: { id: vendor.id, knownDomain: vendor.domain, inMaster: true, approved: true, pendingBankChange: true } });
        relation = decision.ruleIds.includes('LOOKALIKE_DOMAIN') ? 'lookalike' : 'different';
        if (relation === 'lookalike') ruleIds.push('LOOKALIKE_DOMAIN');
      }
      await ctx.assertCurrent();
      return publicView(await record(ctx, input.which === 'sender' ? 'domain_sender' : 'domain_claimed', 'ok',
        { which: input.which, domain: raw && validDomain(raw) ? normalize(raw) : null, relation }, ruleIds));
    },
  };

  const checkBusiness: DomainTool<z.infer<typeof NONE>, Json> = {
    name: 'check_business',
    description: 'Run the CRS sandbox checks for this vendor: public-records bankruptcy count and Fraud Finder risk score (hold at 70 or higher). OFAC is not available in the sandbox and is reported as unavailable, never as clear. Unavailable is not clearance.',
    input: NONE,
    async execute(ctx) {
      await ctx.assertCurrent();
      const { c, vendor } = await master(ctx);
      const ruleIds: string[] = [];
      const facts: { [key: string]: Json } = { ofac: 'unavailable in sandbox', bankruptcies: null, fraudRiskScore: null, fraudSource: null };
      let usable = 0;
      const records = await bounded(() => deps.publicRecords(c.vendorId), ctx.activation.signal, deadline);
      if (records.ok && records.value) {
        usable += 1;
        facts.bankruptcies = records.value.bankruptcies;
        if (records.value.bankruptcies > 0) ruleIds.push('BANKRUPTCY_STOP');
      }
      const fraud = await bounded(() => assessBankChangeRisk(deps.bankChangeRisk, c.vendorId, vendor?.domain ?? c.senderDomain), ctx.activation.signal, deadline);
      if (fraud.ok) {
        const score = fraud.value.inputs.fraudRiskScore;
        const label = String(fraud.value.inputs.label ?? '');
        if (typeof score === 'number') {
          facts.fraudRiskScore = score;
          facts.fraudSource = label.startsWith('FAKE') ? 'synthetic (not checked)' : 'crs_sandbox';
          if (!label.startsWith('FAKE')) usable += 1;
          if (fraud.value.decision?.ruleIds.includes('FRAUD_RISK_HOLD') || score >= CRS_FRAUD_RISK_THRESHOLD) ruleIds.push('FRAUD_RISK_HOLD');
        }
      }
      // Without a usable CRS result the vendor is unchecked; that is a hold, not a pass.
      const status: EvidenceStatus = usable === 0 ? (records.ok || fraud.ok ? 'unavailable' : 'pending') : 'ok';
      await ctx.assertCurrent();
      return publicView(await record(ctx, 'business', status, facts, [...new Set(ruleIds)]));
    },
  };

  /** Shared budget/timeout envelope for the two Apify tools. */
  async function apify<T>(ctx: ToolContext, requestedCapUsd: number, run: (signal: AbortSignal, capUsd: number, settle: (usd?: number) => void) => Promise<T>) {
    const { caseId } = ctx.activation;
    const reservation = deps.budget.reserve(caseId, requestedCapUsd);
    if (!reservation.ok) return { status: 'skipped_budget' as const, reason: reservation.reason };
    const result = await bounded(signal => run(signal, reservation.capUsd, reservation.settle), ctx.activation.signal, deadline);
    if (!result.ok) return { status: result.timedOut ? 'pending' as const : 'unavailable' as const };
    return { status: 'ok' as const, value: result.value };
  }

  const apifySiteCheck: DomainTool<z.infer<typeof NONE>, Json> = {
    name: 'apify_site_check',
    description: 'Run the team\'s published Apify Actor (client-health-check) against the vendor\'s real public website, to see whether it is reachable. Costs money and is capped; a timeout returns pending, which is not evidence either way.',
    input: NONE,
    async execute(ctx) {
      await ctx.assertCurrent();
      const { c, vendor } = await master(ctx);
      if (!vendor || !validDomain(vendor.domain)) {
        return publicView(await record(ctx, 'site_health', 'unavailable', { reason: 'no master domain' }));
      }
      const existing = (await deps.evidence.list(ctx.activation)).find(row => row.kind === 'site_health');
      if (existing) return publicView(existing);
      const company = deps.companyFor?.(c.vendorId, vendor) ?? { name: c.vendorId, website: `https://${normalize(vendor.domain)}/` };
      const out = await apify(ctx, deps.budget.perRunCapUsd, async () => boundedHealthCheck(deps.health, company));
      await ctx.assertCurrent();
      if (out.status !== 'ok') return publicView(await record(ctx, 'site_health', out.status, { runId: null, websiteReachable: null }));
      if (!out.value) return publicView(await record(ctx, 'site_health', 'pending', { runId: null, websiteReachable: null }));
      const reachable = out.value.signals.find(signal => signal.type === 'website_reachable');
      const maps = out.value.signals.find(signal => signal.type === 'maps_status');
      const facts = { runId: out.value.apifyRunId ?? null, websiteReachable: reachable ? reachable.value === true : null,
        mapsStatus: maps && maps.type === 'maps_status' ? maps.value : null, signalCount: out.value.signals.length };
      return publicView(await record(ctx, 'site_health', facts.websiteReachable === null ? 'unavailable' : 'ok', facts));
    },
  };

  const apifyContactPage: DomainTool<z.infer<typeof NONE>, Json> = {
    name: 'apify_contact_page',
    description: 'Run the Apify Store Contact Details Scraper on the vendor\'s own website (from the master domain, max 3 pages) and report whether the sender or claimed email domain is one the vendor publicly uses. Use this to corroborate a bank-change request. Costs money and is capped; pending is not evidence.',
    input: NONE,
    async execute(ctx) {
      await ctx.assertCurrent();
      const { c, vendor } = await master(ctx);
      if (!vendor || !validDomain(vendor.domain)) {
        return publicView(await record(ctx, 'contact_page', 'unavailable', { reason: 'no master domain' }));
      }
      const existing = (await deps.evidence.list(ctx.activation)).find(row => row.kind === 'contact_page');
      if (existing) return publicView(existing);
      const startUrl = `https://${normalize(vendor.domain)}/`;
      const out = await apify(ctx, CONTACT_CAP_USD, async (signal, capUsd, settle) => {
        const scrape = await deps.contact({ startUrl, capUsd, signal });
        settle(scrape.usageUsd);
        return { runId: scrape.runId, footprint: projectContactItems(scrape.items) };
      });
      await ctx.assertCurrent();
      if (out.status !== 'ok') return publicView(await record(ctx, 'contact_page', out.status, { runId: null }));
      const { runId, footprint } = out.value;
      if (footprint.pagesSeen === 0) return publicView(await record(ctx, 'contact_page', 'unavailable', { runId, pagesSeen: 0 }));
      const facts = { runId, pagesSeen: footprint.pagesSeen, publishedEmailDomains: footprint.emailDomains.length,
        masterDomainPublished: siteCorroboratesDomain(footprint, vendor.domain),
        senderDomainPublished: validDomain(c.senderDomain) ? siteCorroboratesDomain(footprint, c.senderDomain) : false,
        claimedDomainPublished: c.claimedDomain && validDomain(c.claimedDomain) ? siteCorroboratesDomain(footprint, c.claimedDomain) : null };
      return publicView(await record(ctx, 'contact_page', 'ok', facts));
    },
  };

  const concludeVerification: DomainTool<{ outcome: VendorOutcome; note: string }, Json> = {
    name: 'conclude_verification',
    description: 'Record your verification outcome: proceed (Payables may continue), return_to_extractor (the document fields look wrong and need re-extraction), or human_review (Dana must look). Code checks your outcome against the evidence and the stop rules and returns ALLOW or DENY. It runs once; after ALLOW, call handoff (proceed or return_to_extractor) or finish (human_review).',
    input: z.object({ outcome: z.enum(['proceed', 'return_to_extractor', 'human_review']), note: z.string().min(1).max(400) }).strict(),
    async execute(ctx, input): Promise<Json> {
      await ctx.assertCurrent();
      const rows = await deps.evidence.list(ctx.activation);
      const sealed = rows.find(row => row.kind === 'verdict');
      if (sealed) return { decision: 'DENY', reason: 'VERDICT_SEALED', verdictRef: sealed.ref, outcome: sealed.facts.outcome ?? null };
      const { c } = await master(ctx);
      const verdict = assess(c, rows);
      if (verdict.missing.length) return { decision: 'DENY', reason: 'MISSING_EVIDENCE', run: verdict.missing };
      if (!verdict.allowed.includes(input.outcome)) {
        return { decision: 'DENY', reason: 'OUTCOME_NOT_ALLOWED', allowed: verdict.allowed, ruleIds: verdict.ruleIds, flags: verdict.flags };
      }
      const decision = input.outcome === 'human_review' ? humanDecision(verdict.ruleIds) : undefined;
      await ctx.assertCurrent();
      const row = await record(ctx, 'verdict', 'ok', {
        outcome: input.outcome, next: input.outcome === 'proceed' ? 'payables' : input.outcome === 'return_to_extractor' ? 'extractor' : 'human',
        flags: verdict.flags, pending: verdict.pending, evidenceRefs: rows.map(r => r.ref),
        // Model prose is stored as data for people; it never feeds a rule.
        note: input.note, ...(decision ? { decision: decision as unknown as Json } : {}),
      }, verdict.ruleIds);
      // Report the rule code actually sealed (e.g. the default BANK_CHANGE_HOLD), so a handoff can cite it.
      return { decision: 'ALLOW', verdictRef: row.ref, outcome: input.outcome, next: row.facts.next ?? null, pending: verdict.pending, flags: verdict.flags,
        ruleIds: decision ? [...decision.ruleIds] : verdict.ruleIds, evidenceRuleIds: verdict.ruleIds };
    },
  };

  return [getVendorMaster, checkDomain, checkBusiness, apifySiteCheck, apifyContactPage, concludeVerification];
}

const HARD_RULES = new Set(['BANKRUPTCY_STOP', 'OFAC_STOP', 'FRAUD_RISK_HOLD', 'LOOKALIKE_DOMAIN', 'PAYEE_NOT_IN_MASTER']);

export interface Assessment {
  missing: EvidenceKind[]; allowed: VendorOutcome[]; ruleIds: string[]; flags: string[]; pending: string[];
}
/** Pure verdict logic: the model may choose any outcome in `allowed`, never one outside it. */
export function assess(c: VendorCase, rows: readonly EvidenceRecord[]): Assessment {
  const by = new Map(rows.map(row => [row.kind, row]));
  const required: EvidenceKind[] = ['vendor_master', 'domain_sender', 'business'];
  if (c.claimedDomain !== undefined) required.push('domain_claimed');
  const missing = required.filter(kind => !by.has(kind));
  const ruleIds = [...new Set(rows.flatMap(row => row.ruleIds))];
  const flags: string[] = [], pending: string[] = [];
  const masterFacts = by.get('vendor_master')?.facts;
  const sender = by.get('domain_sender')?.facts.relation, claimed = by.get('domain_claimed')?.facts.relation;
  const business = by.get('business');
  // Unavailable evidence never clears: CRS that did not answer holds the vendor for a person.
  if (business && business.status !== 'ok') { flags.push('CRS_UNVERIFIED'); pending.push('business'); }
  for (const kind of ['site_health', 'contact_page'] as const) {
    const row = by.get(kind);
    if (!row) pending.push(kind);
    else if (row.status !== 'ok') pending.push(kind);
  }
  if (sender && sender !== 'exact') flags.push(`SENDER_DOMAIN_${String(sender).toUpperCase()}`);
  if (claimed && claimed !== 'exact') flags.push(`CLAIMED_DOMAIN_${String(claimed).toUpperCase()}`);
  if (masterFacts?.accountMatchesDocument === false) flags.push('ACCOUNT_DIFFERS_FROM_MASTER');
  if (masterFacts?.pendingBankChange === true) flags.push('BANK_CHANGE_PENDING');
  const site = by.get('site_health')?.facts, contact = by.get('contact_page')?.facts;
  if (site?.websiteReachable === false) flags.push('SITE_UNREACHABLE');
  if (contact && by.get('contact_page')?.status === 'ok' && contact.senderDomainPublished === false) flags.push('SENDER_DOMAIN_NOT_ON_VENDOR_SITE');
  if (site?.mapsStatus === 'permanently_closed') flags.push('LISTING_CLOSED');

  const hard = ruleIds.filter(rule => HARD_RULES.has(rule));
  const allowed = new Set<VendorOutcome>(['human_review']);
  const extractionOnly = hard.every(rule => rule === 'PAYEE_NOT_IN_MASTER') &&
    (hard.length > 0 || ['missing', 'invalid'].includes(String(claimed)));
  if (extractionOnly) allowed.add('return_to_extractor');
  const bankChange = c.kind === 'bank_change' || flags.includes('ACCOUNT_DIFFERS_FROM_MASTER') || flags.includes('BANK_CHANGE_PENDING');
  // A legitimate bank change still needs Dana's passkey, so "proceed" is never offered for one.
  const domainsClean = sender === 'exact' && (claimed === undefined || claimed === 'exact');
  // Soft web signals (site down, listing closed, sender not on the vendor's site) contradict clean CRS.
  // They do not block `proceed` for a routine invoice; the reasoning model must weigh them and say why.
  if (hard.length === 0 && !bankChange && domainsClean && !flags.includes('CRS_UNVERIFIED')) allowed.add('proceed');
  return { missing, allowed: [...allowed], ruleIds, flags, pending };
}

function humanDecision(ruleIds: string[]): Decision {
  const order = ['OFAC_STOP', 'BANKRUPTCY_STOP', 'FRAUD_RISK_HOLD', 'LOOKALIKE_DOMAIN', 'PAYEE_NOT_IN_MASTER'];
  const rule = order.find(r => ruleIds.includes(r)) ?? 'BANK_CHANGE_HOLD';
  return { kind: 'ESCALATE', ruleIds: [rule], policyVersion: DEFAULT_POLICY.policyVersion, toHuman: DEFAULT_POLICY.toHuman,
    reason: `Vendor verifier hold: ${rule}`, quote: { sentenceId: 'NF-019', text: 'Dana must verify and approve this bank change before payment.' } } as unknown as Decision;
}

/** For the HandoffStore: a vendor handoff must cite a sealed verdict whose outcome matches the target. */
export async function assertVendorHandoff(store: Pick<VendorEvidenceStore, 'get'>, request: HandoffRequest): Promise<void> {
  const refs = await Promise.all(request.artifactRefs.filter(ref => ref.startsWith('vendor-evidence:') && ref.endsWith(':verdict')).map(ref => store.get(ref)));
  const verdict = refs.find(Boolean);
  if (!verdict) throw new Error('VENDOR_VERDICT_REQUIRED');
  const expected = verdict.facts.next;
  if (request.to === 'payables' && expected !== 'payables') throw new Error('VENDOR_VERDICT_BLOCKS_PAYABLES');
  if (request.to === 'extractor' && expected !== 'extractor') throw new Error('VENDOR_VERDICT_MISMATCH');
  if (request.to !== 'payables' && request.to !== 'extractor') throw new Error('VENDOR_EDGE_NOT_ALLOWED');
}
