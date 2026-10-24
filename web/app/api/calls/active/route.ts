import { activeCall } from '../../../../lib/calls/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public, read-only desk-phone feed: code decisions only, masked amounts, no numbers or link codes. */
export async function GET() {
  try { return Response.json({ call: await activeCall() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'CALL_FEED_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
