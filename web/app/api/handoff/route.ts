import { createHandoffProxy } from '../../../lib/office/handoff-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The secret is read here, server-side, and attached only to the upstream request.
const handle = createHandoffProxy({
  origin: () => process.env.WEBAUTHN_ORIGIN,
  secret: () => process.env.TOOL_GATEWAY_SECRET,
});
export const POST = handle;
export const GET = handle;
