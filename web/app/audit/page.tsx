import { AuditWall } from '../../components/AuditWall';
import { loadReplay } from '../../lib/replay/load';
import { ReplaySession, ReplayUnavailable } from '../../components/ReplaySession';

export const metadata = { title: 'Audit wall · Backroom' };
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ replay?: string | string[] }> }) {
  const { replay } = await searchParams;
  if (replay !== undefined) {
    const recording = typeof replay === 'string' ? await loadReplay(replay) : undefined;
    return recording ? <ReplaySession recording={recording} view='audit' /> : <ReplayUnavailable />;
  }
  return <main style={{ background: '#111113' }}>
    <nav aria-label="Office" style={{ padding: '16px 24px 0', fontFamily: 'system-ui, sans-serif' }}><a href="/" style={{ color: '#d8d8e0' }}>← Back to office</a></nav>
    <AuditWall />
  </main>;
}
