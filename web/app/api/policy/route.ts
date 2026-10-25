import { getStateStore } from '@backroom/orchestrator';
import { declaredLoopbackOfficeOrigin } from '../../../lib/calls/loopback-origin';
import { createPolicyHTTP } from '../../../lib/policy-editor/http';
import { hostSignedIn } from '../../../lib/operator/sign-in';
export const runtime = 'nodejs';
const handle = createPolicyHTTP({ store: getStateStore, pin: () => process.env.POLICY_DEMO_PIN,
  origin: () => process.env.POLICY_EDITOR_ORIGIN ?? process.env.WEBAUTHN_ORIGIN,
  loopbackOrigin: () => declaredLoopbackOfficeOrigin(), signedIn: hostSignedIn });
export const GET = handle;
export const POST = handle;
