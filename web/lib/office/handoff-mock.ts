import type { Handoff, HandoffRole } from './handoffs';
export interface HandoffFeed { subscribe(listener: () => void): () => void; getRows(): readonly Handoff[]; start(): void; stop(): void }
interface Step {
  from: HandoffRole; to: HandoffRole; at: number; accept?: number; complete?: number; reject?: number;
  caseDisplayId: string; reason: string; summary: string; correction?: boolean; errorCode?: string; decisionRef?: string;
}
export const MOCK_HANDOFF_SCRIPT: readonly Step[] = [
  { from: 'intake', to: 'extractor', at: 0, accept: 2500, complete: 5000, caseDisplayId: 'INV-1042', reason: 'Invoice received', summary: 'Extract the invoice fields' },
  { from: 'collections', to: 'auditor', at: 0, accept: 6500, complete: 9000, caseDisplayId: 'INV-0977', reason: 'Review call record', summary: 'Consent record attached' },
  { from: 'intake', to: 'extractor', at: 1500, accept: 6500, complete: 9000, caseDisplayId: 'INV-1043', reason: 'Invoice received', summary: 'Check supporting documents' },
  { from: 'extractor', to: 'vendor', at: 11000, caseDisplayId: 'INV-1043', reason: 'Remit-to ••4821 does not match', summary: 'Extractor keeps the case', errorCode: 'VENDOR_MISMATCH' },
  { from: 'vendor', to: 'payables', at: 16000, accept: 21000, complete: 26000, caseDisplayId: 'INV-1044', reason: 'Vendor documents checked', summary: 'Review payment evidence' },
  { from: 'payables', to: 'vendor', at: 29000, accept: 35000, complete: 39000, caseDisplayId: 'INV-1044', reason: 'Missing tax form', summary: 'Return to vendor for correction', correction: true },
  { from: 'payables', to: 'reconciler', at: 42000, accept: 45000, complete: 52000, caseDisplayId: 'INV-1045', reason: 'Human approval escalation · waiting for Dana’s passkey', summary: 'Approval evidence requires a human', decisionRef: 'PASSKEY-42' },
  { from: 'payables', to: 'reconciler', at: 54000, reject: 56000, caseDisplayId: 'INV-1046', reason: 'Case cancelled before acceptance', summary: 'GB29 NWBK ••6819 / [email]', errorCode: 'CASE_STOPPED' },
  { from: 'intake', to: 'extractor', at: 54000, accept: 55000, reject: 58000, caseDisplayId: 'INV-1047', reason: 'Case stopped after acceptance', summary: 'Return documents for ••6819', errorCode: 'CASE_STOPPED' },
];
// Fixture voice keys from #133; production rows provide these directly.
const voice = (role: HandoffRole) => role === 'intake' ? 'intake_sorter' : role === 'vendor' ? 'vendor_verifier' : role === 'collections' ? 'collections_caller' : role;
// Leave time for the longer walks across the square hall before the fixture repeats.
export const MOCK_CYCLE_MS = 90_000;
export function mockCycleRows(cycle: number, cycleStart: number, now: number, speed = 1): Handoff[] {
  const time = (offset: number) => cycleStart + offset / speed;
  return MOCK_HANDOFF_SCRIPT.flatMap((step, i) => {
    if (time(step.at) > now) return [];
    const acceptedAt = step.accept !== undefined && time(step.accept) <= now ? time(step.accept) : undefined;
    const completedAt = step.complete !== undefined && time(step.complete) <= now ? time(step.complete) : undefined;
    const rejected = !!step.errorCode && (step.reject === undefined || time(step.reject) <= now);
    return [{ handoffId: `mock-${cycle}-${i + 1}`, sequence: BigInt(cycle * MOCK_HANDOFF_SCRIPT.length + i + 1),
      caseDisplayId: step.caseDisplayId, fromAgentId: `${step.from}-agent`, toAgentId: `${step.to}-agent`,
      fromRole: step.from, toRole: step.to, fromVoiceRole: voice(step.from), toVoiceRole: voice(step.to),
      status: rejected ? 'rejected' as const : completedAt !== undefined ? 'completed' as const : acceptedAt !== undefined ? 'accepted' as const : 'offered' as const,
      correction: step.correction ?? false, reason: step.reason, summary: step.summary, line: step.summary,
      createdAt: time(step.at), acceptedAt, completedAt, errorCode: rejected ? step.errorCode : undefined, decisionRef: step.decisionRef }];
  });
}
export function createMockHandoffFeed({ speed = 1, now = () => Date.now(), lead = 600 }: { speed?: number; now?: () => number; lead?: number } = {}): HandoffFeed {
  const listeners = new Set<() => void>();
  let rows: readonly Handoff[] = [], timer: ReturnType<typeof setInterval> | undefined, origin = 0, signature = '';
  const rebuild = () => {
    const current = now(), cycle = Math.max(0, Math.floor((current - origin) / (MOCK_CYCLE_MS / speed)));
    const next = [cycle - 1, cycle].filter(n => n >= 0).flatMap(n => mockCycleRows(n, origin + n * MOCK_CYCLE_MS / speed, current, speed));
    const key = next.map(row => `${row.handoffId}:${row.status}`).join('|');
    if (key === signature) return;
    signature = key; rows = next; listeners.forEach(fn => fn());
  };
  return {
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getRows: () => rows,
    start() { if (timer !== undefined) return; origin = now() + lead; rebuild(); timer = setInterval(rebuild, 100 / speed); },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
