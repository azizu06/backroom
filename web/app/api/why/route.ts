import { createWhyHTTP } from '../../../lib/why-voice/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handle = createWhyHTTP();
export const POST = (request: Request) => handle(request, 'text');
