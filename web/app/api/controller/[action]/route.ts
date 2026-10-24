import { createApprovalHTTP } from '../../../../lib/approvals/http';
import { controllerApprovals } from '../../../../lib/approvals/runtime';
export const runtime = 'nodejs';
const handle = createApprovalHTTP(controllerApprovals, () => process.env.WEBAUTHN_ORIGIN);
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return handle('controller', '', (await context.params).action, request);
}
export const POST = GET;
