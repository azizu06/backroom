import { createAttackDemoProxy } from '../../../lib/attack-demo/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Read credentials here, server-side; never pass them through client props.
const handle = createAttackDemoProxy({
  origin: () => process.env.WEBAUTHN_ORIGIN,
  secret: () => process.env.TOOL_GATEWAY_SECRET,
  baseUrl: process.env.ATTACK_DEMO_BASE_URL || undefined,
  allowLive: () => process.env.ATTACK_DEMO_LIVE === '1',
});
export const POST = handle;
export const GET = handle;
