import { getPrecallEvidence, precallCard } from '../../../../lib/calls/precall';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public, read-only pre-call card: evidence the host already fetched. Starts no Apify or CRS check. */
export async function GET() {
  try { return Response.json({ card: precallCard(getPrecallEvidence()) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'PRECALL_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
