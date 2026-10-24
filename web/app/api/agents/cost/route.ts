import { createAgentsCostProxy } from '../../../../lib/agents/cost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createAgentsCostProxy({
  origin: () => process.env.WEBAUTHN_ORIGIN,
  secret: () => process.env.TOOL_GATEWAY_SECRET,
});
