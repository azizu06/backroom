import { createLlmControlHandler } from '@backroom/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = createLlmControlHandler();
export const GET = handle;
export const POST = handle;
