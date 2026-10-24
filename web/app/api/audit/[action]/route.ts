import { getStateStore } from '@backroom/orchestrator';
import { createAuditHTTP } from '../../../../lib/audit/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = createAuditHTTP({ store: getStateStore,
  secret: () => process.env.CONTROLLER_ENROLLMENT_SECRET, origin: () => process.env.WEBAUTHN_ORIGIN });
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return handle((await context.params).action, request);
}
export const POST = GET;
