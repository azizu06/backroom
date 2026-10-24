import { handleCallRequest } from '../../../../lib/calls/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => handleCallRequest('request', request);
export const GET = POST;
