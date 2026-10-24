import { paymentHttp } from '../../../../lib/payments/http';
import { getPaymentService } from '../../../../lib/payments/runtime';
export const runtime = 'nodejs';
const handle = paymentHttp(getPaymentService);
type Context = { params: Promise<{ linkId: string }> };
export async function GET(request: Request, { params }: Context) { return handle(request, (await params).linkId); }
export async function POST(request: Request, { params }: Context) { return handle(request, (await params).linkId); }
