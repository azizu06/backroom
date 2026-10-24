import { DEFAULT_POLICY, evaluate } from '@backroom/policy';
import { audit, domain, hold } from '../payables/decisions';
import { sourceSchema, vendorSchema } from '../payables/schemas';
import type { BankChange, InboxSource, SeatOptions, SeatResult, VendorFields } from '../payables';

/** Adapters map only trusted fixture/master identity IDs to CRS sandbox identities.
 * Apify data is reduced to booleans/domain/evidence; scraped text never reaches tools.
 */
export interface VendorChecks {
  business(vendorId: string): Promise<{ verified: boolean; evidenceRef: string }>;
  ofac(vendorId: string): Promise<{ status: 'clear' | 'hit' | 'unknown'; evidenceRef: string }>;
  footprint(vendorId: string): Promise<{ websiteReachable: boolean; listingOperating: boolean; domain: string; evidenceRef: string }>;
}
export class VendorSeat {
  constructor(private readonly options: SeatOptions & { checks: VendorChecks }) {}
  async propose(unchecked: VendorFields, envelope: InboxSource): Promise<SeatResult> {
    const fields = vendorSchema.parse(unchecked), source = sourceSchema.parse(envelope), repo = this.options.repository;
    return repo.withVendorLock(`proposal:${source.id}`, () => repo.withVendorLock(`vendor:${fields.vendorId}`, async () => {
      const previous = await repo.getBankChange(source.id);
      if (previous) {
        if (JSON.stringify(previous.fields) !== JSON.stringify(fields) || JSON.stringify(previous.source) !== JSON.stringify(source)) throw new Error('PROPOSAL_ID_CONFLICT');
        if (!previous.result.escalationId && previous.result.decision.kind === 'ESCALATE') {
          previous.result.escalationId = await this.options.controller.request(previous.result.decision, [source.id]);
          await repo.saveBankChange(previous);
        }
        return previous.result;
      }
      const vendor = await repo.getVendor(fields.vendorId);
      // A resend is not a new change when it names the current approved master.
      // Only apply() can install a changed account after the bound passkey decision.
      if (fields.kind === 'bank_change' && vendor?.approved && vendor.inMaster !== false && !vendor.ofacHit &&
          fields.bankAccountId === vendor.accountId && domain(source.senderDomain) === domain(vendor.domain) &&
          domain(fields.domain) === domain(vendor.domain) && !await repo.hasPendingBankChange(vendor.id)) {
        const result: SeatResult = { status: 'approved', decision: { kind: 'ALLOW', ruleIds: ['IN_BADGE'],
          policyVersion: DEFAULT_POLICY.policyVersion }, evidenceRefs: [source.id] };
        await audit(this.options, 'vendor_onboarding', 'bank_change_already_applied', source, result.decision, [],
          { vendorId: vendor.id, vendorRevision: vendor.revision, bankChanged: false });
        return result;
      }
      let decision = fields.kind === 'bank_change'
        ? vendor ? evaluate('vendor_onboarding', { type: 'propose_bank_change', emailDomain: source.senderDomain }, {
          vendor: { id: vendor.id, knownDomain: vendor.domain, inMaster: vendor.inMaster ?? true, approved: vendor.approved, pendingBankChange: true },
        }) : hold('PAYEE_NOT_IN_MASTER') : hold('PAYEE_NOT_IN_MASTER');
      let canVerify = fields.kind === 'bank_change' ? vendor?.approved === true && vendor.inMaster !== false : !vendor || vendor.inMaster === false;
      const knownDomain = vendor?.domain ?? fields.domain;
      if (domain(source.senderDomain) !== domain(knownDomain) || domain(fields.domain) !== domain(knownDomain)) canVerify = false;
      const refs = [source.id];
      let verified = false, sanctioned = false;
      // Checks are fixed code actions, never tools selected by email text or model output.
      if (canVerify && evaluate('vendor_onboarding', { type: 'run_crs' }, {}).kind === 'ALLOW' &&
          evaluate('vendor_onboarding', { type: 'run_apify' }, {}).kind === 'ALLOW') {
        try {
          const [business, ofac, footprint] = await Promise.all([
            this.options.checks.business(fields.vendorId), this.options.checks.ofac(fields.vendorId), this.options.checks.footprint(fields.vendorId),
          ]);
          const evidence = [business.evidenceRef, ofac.evidenceRef, footprint.evidenceRef];
          if (!evidence.every(ref => typeof ref === 'string' && /^[A-Za-z0-9_.:/-]{1,200}$/.test(ref))) throw new Error('INVALID_EVIDENCE');
          refs.push(...evidence);
          sanctioned = ofac.status === 'hit';
          verified = business.verified === true && ofac.status === 'clear' && footprint.websiteReachable === true &&
            footprint.listingOperating === true && domain(footprint.domain) === domain(knownDomain);
          if (sanctioned) decision = hold('OFAC_STOP');
          else if (!verified) decision = hold('INVALID_INPUT');
        } catch { decision = hold('INVALID_INPUT'); }
      }
      const result: SeatResult = { status: sanctioned || decision.ruleIds.includes('LOOKALIKE_DOMAIN') ? 'rejected' : verified ? 'awaiting_controller' : 'held', decision, evidenceRefs: refs };
      const change: BankChange = { id: source.id, fields, source, baselineRevision: vendor?.revision ?? null, verified, result };
      // Freeze the exact proposal BEFORE requesting approval. Recovery may reattach an
      // escalation, but cannot substitute a new account under an existing source ID.
      await repo.saveBankChange(change);
      if (decision.kind === 'ESCALATE') {
        result.escalationId = await this.options.controller.request(decision, [source.id]);
        await repo.saveBankChange(change);
      }
      await audit(this.options, 'vendor_onboarding', verified ? 'vendor_verified' : 'vendor_rejected_or_unverified', source,
        decision, refs.slice(1), { vendorId: fields.vendorId, proposal: verified ? 'verified' : 'reject', senderDomain: source.senderDomain, vendorDomain: knownDomain, bankChanged: fields.kind === 'bank_change' });
      return result;
    }));
  }
  /** No caller-supplied approval. Read the exact escalation from authoritative state. */
  async apply(proposalId: string): Promise<SeatResult> {
    const repo = this.options.repository;
    return repo.withVendorLock(`proposal:${proposalId}`, async () => {
      const change = await repo.getBankChange(proposalId);
      if (!change) throw new Error('PROPOSAL_NOT_FOUND');
      return repo.withVendorLock(`vendor:${change.fields.vendorId}`, async () => {
        if (['approved', 'rejected'].includes(change.result.status) || !change.result.escalationId) return change.result;
        await this.options.state.expireEscalations((this.options.now ?? Date.now)());
        const approval = await this.options.state.getEscalation(change.result.escalationId);
        if (approval && ['counter', 'pending_owner'].includes(approval.status)) {
          change.result.status = 'held';
          await repo.saveBankChange(change);
          return change.result;
        }
        if (!approval || !['approved', 'denied'].includes(approval.status)) return change.result;
        const vendor = await repo.getVendor(change.fields.vendorId);
        const bound = approval.id === change.result.escalationId && approval.evidenceRefs.includes(change.id) &&
          approval.toHuman === DEFAULT_POLICY.toHuman && approval.policyVersion === change.result.decision.policyVersion &&
          approval.ruleIds.some(rule => change.result.decision.ruleIds.some(expected => expected === rule));
        const passkey = approval.method === 'passkey' && typeof approval.credentialId === 'string' && !!approval.credentialId &&
          typeof approval.decidedAt === 'number' && Number.isFinite(approval.decidedAt) &&
          approval.decidedAt >= approval.createdAt && approval.decidedAt < approval.expiresAt &&
          approval.decision?.kind === (approval.status === 'approved' ? 'Approve' : 'Deny');
        if (!bound || !passkey) return change.result;
        if (approval.status === 'denied') change.result.status = 'rejected';
        else if (!change.verified || change.result.status !== 'awaiting_controller') return change.result;
        else if ((vendor?.revision ?? null) !== change.baselineRevision) {
          change.result.status = 'held'; change.verified = false;
        } else {
          change.result.status = 'approved';
          change.result.decision = { kind: 'ALLOW', ruleIds: change.result.decision.ruleIds, policyVersion: change.result.decision.policyVersion };
          await repo.commitApprovedChange(change, { id: change.fields.vendorId, domain: vendor?.domain ?? change.fields.domain,
            accountId: change.fields.bankAccountId, approved: true, revision: (vendor?.revision ?? 0) + 1, ofacHit: false });
        }
        if (change.result.status !== 'approved') await repo.saveBankChange(change);
        await audit(this.options, 'vendor_onboarding', `bank_change_${change.result.status}`, change.source,
          change.result.decision, change.result.evidenceRefs.slice(1), { escalationId: approval.id, controllerDecision: approval.status, method: approval.method }, 'human');
        return change.result;
      });
    });
  }
}
