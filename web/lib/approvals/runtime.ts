import { ControllerApprovals, MemoryStateStore, type StateStore } from '@backroom/orchestrator';

// One server process, including Next dev reloads and separate route bundles.
const root = globalThis as typeof globalThis & { backroomApprovals?: {
  store: StateStore; service?: ControllerApprovals;
} };
const runtime = root.backroomApprovals ??= { store: new MemoryStateStore() };
export const approvalState: StateStore = new Proxy({} as StateStore, {
  get(_target, key) { const member = runtime.store[key as keyof StateStore]; return member.bind(runtime.store); },
});
/** Install only at trusted bootstrap, together with the gateway's durable adapter. */
export function installApprovalStateStore(store: StateStore) {
  if (runtime.service) throw new Error('APPROVAL_SERVICE_ALREADY_STARTED');
  runtime.store = store;
}
export function controllerApprovals() {
  const origin = process.env.WEBAUTHN_ORIGIN;
  const rpID = process.env.WEBAUTHN_RP_ID;
  const enrollmentSecret = process.env.CONTROLLER_ENROLLMENT_SECRET;
  if (!origin || !rpID || !enrollmentSecret) throw new Error('APPROVALS_NOT_CONFIGURED');
  return runtime.service ??= new ControllerApprovals(approvalState, { origin, rpID, enrollmentSecret });
}
