import type { GatewayCall } from '../../gateway/store';
/** Explicitly synthetic local fixture. It never dials, sends email, or touches a bank. */
export function approvalDemoCall(callId = 'approval-demo'): GatewayCall {
  return { callId, agentId: 'collections-1', invoiceId: '1042', clientId: 'demo-client',
    contactName: 'Jordan', companyName: 'Northfield Studio', amountCents: 495000,
    receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1,
    identityConfirmed: true, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
}
