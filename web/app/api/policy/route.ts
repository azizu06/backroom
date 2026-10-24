import { getStateStore } from '@backroom/orchestrator';
import { createPolicyHTTP } from '../../../lib/policy-editor/http';
export const runtime = 'nodejs';
const handle = createPolicyHTTP({ store: getStateStore, pin: () => process.env.POLICY_DEMO_PIN,
  origin: () => process.env.POLICY_EDITOR_ORIGIN ?? process.env.WEBAUTHN_ORIGIN });
export const GET = handle;
export const POST = handle;
