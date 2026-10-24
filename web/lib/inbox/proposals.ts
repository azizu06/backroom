import type { FinanceRepository, VendorSeat } from '@backroom/orchestrator';

/** One web process. The approval route applies the same proposal the inbox verified. */
const root = globalThis as typeof globalThis & { backroomInboxProposals?: Map<string, {
  seat: VendorSeat; repository: FinanceRepository; vendorId: string; proposalId: string;
}> };
const proposals = root.backroomInboxProposals ??= new Map();

export function rememberInboxProposal(escalationId: string, pending: {
  seat: VendorSeat; repository: FinanceRepository; vendorId: string; proposalId: string;
}) {
  proposals.delete(escalationId);
  proposals.set(escalationId, pending);
  while (proposals.size > 50) {
    const oldest = proposals.keys().next().value;
    if (oldest === undefined) break;
    proposals.delete(oldest);
  }
}

export async function readInboxBankChange(escalationId: string) {
  const pending = proposals.get(escalationId);
  if (!pending) return;
  const change = await pending.repository.getBankChange(pending.proposalId);
  const vendor = await pending.repository.getVendor(pending.vendorId);
  return { status: change?.result.status, accountId: vendor?.accountId ?? null, verified: change?.verified === true };
}

/** No-op when this escalation is not a judge bank change. A passkey is read from state, never from the caller. */
export async function applyInboxBankChange(escalationId: string) {
  const pending = proposals.get(escalationId);
  if (!pending) return;
  const result = await pending.seat.apply(pending.proposalId);
  const vendor = await pending.repository.getVendor(pending.vendorId);
  if (result.status === 'approved' || result.status === 'rejected') proposals.delete(escalationId);
  return { status: result.status, accountId: vendor?.accountId ?? null, ruleIds: result.decision.ruleIds };
}
