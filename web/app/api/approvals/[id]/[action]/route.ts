import { createApprovalHTTP } from '../../../../../lib/approvals/http';
import { controllerApprovals } from '../../../../../lib/approvals/runtime';
export const runtime = 'nodejs';
const handle = createApprovalHTTP(controllerApprovals, () => process.env.WEBAUTHN_ORIGIN);
type Context = { params: Promise<{ id: string; action: string }> };
export async function GET(request: Request, context: Context) {
  const { id, action } = await context.params;
  return handle('approval', id, action, request);
}
export const POST = GET;
