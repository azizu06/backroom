import policy from '../../../policy/src/northfield.json';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot, type OfficeState, type SeatId } from './state';

/** Fixture producer only; never used as a live StateStore or approval transport. */
export function createMockOfficeState() {
  let snapshot: OfficeSnapshot = {
    ...INITIAL_OFFICE, connection: 'preview', inboxCount: 3,
    agents: [
      { id: 'collections-clerk', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: OFFICE_ANCHORS.collections.position, state: 'Reviewing invoice 1042' },
      { id: 'payables-clerk', name: 'Sam', seatId: 'payables', targetAnchor: 'payables', pos: OFFICE_ANCHORS.payables.position, state: 'Matching invoices' },
      { id: 'vendor-clerk', name: 'Jules', seatId: 'vendor_onboarding', targetAnchor: 'vendor_onboarding', pos: OFFICE_ANCHORS.vendor_onboarding.position, state: 'Checking vendor evidence' },
    ],
    badges: Object.entries(policy.badges).map(([seatId, badge]) => ({
      seatId: seatId as SeatId, policyVersion: policy.policyVersion,
      actions: badge.actions, rooms: badge.rooms,
      limits: 'limits' in badge ? badge.limits : 'maxPaymentCents' in badge
        ? { maxPaymentCents: badge.maxPaymentCents, account: badge.account } : {},
    })),
  };
  const listeners = new Set<() => void>();
  const publish = (next: OfficeSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const source: OfficeState = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    source,
    setTargetAnchor(targetAnchor: AnchorId) {
      if (snapshot.agents[0]?.targetAnchor === targetAnchor) return;
      publish({ ...snapshot, agents: snapshot.agents.map((agent, i) => i ? agent : {
        ...agent, targetAnchor, escalationId: targetAnchor === 'dana' ? 'preview-escalation-1042' : undefined,
        state: targetAnchor === 'dana' ? 'Four installments requested · awaiting Dana' : 'Reviewing invoice 1042',
      }), audit: targetAnchor === 'dana' ? [...snapshot.audit, {
        id: `preview-escalation-${snapshot.audit.length}`, agentId: 'collections-clerk', seatId: 'collections',
        action: 'propose_plan', decision: 'ESCALATE', ruleIds: ['MAX_INSTALLMENTS'],
        summary: 'Invoice 1042 · four installments → Dana',
      }] : snapshot.audit });
    },
    denyTreasury() {
      const id = `preview-denial-${snapshot.audit.length}`;
      publish({ ...snapshot, denials: [{ room: 'treasury', agentId: 'collections-clerk', auditId: id, at: Date.now() }],
        audit: [...snapshot.audit, { id, agentId: 'collections-clerk', seatId: 'collections', room: 'treasury',
          action: 'request_room_entry', decision: 'DENY', ruleIds: ['NOT_IN_BADGE'], summary: 'Treasury entry refused · controller only' }] });
    },
  };
}
