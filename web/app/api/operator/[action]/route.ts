import { getStateStore, x402TestnetAvailability } from '@backroom/orchestrator';
import { createOperatorHTTP } from '../../../../lib/operator/http';
import { runOperatorAction } from '../../../../lib/operator/actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Keep the concurrency gate across route bundles and dev reloads in this single-host demo.
const root = globalThis as typeof globalThis & { backroomOperatorHTTP?: ReturnType<typeof createOperatorHTTP> };
const handle = root.backroomOperatorHTTP ??= createOperatorHTTP({ env: () => process.env, store: getStateStore, run: runOperatorAction,
  session: () => ({ x402Testnet: x402TestnetAvailability() }) });
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) { return handle((await context.params).action, request); }
export const POST = GET;
