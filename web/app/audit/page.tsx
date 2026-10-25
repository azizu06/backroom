import { AuditWall } from '../../components/AuditWall';
import { CODE_REJECTED, ORIGIN_REJECTED } from '../../lib/audit/session-message';
import { loadReplay } from '../../lib/replay/load';
import { ReplaySession, ReplayUnavailable } from '../../components/ReplaySession';
// Office palette tokens (:root) for the wall outside the office route.
import '../office/lobby.css';

export const metadata = { title: 'Audit wall · Backroom' };
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ replay?: string | string[] }> }) {
  const { replay } = await searchParams;
  if (replay !== undefined) {
    const recording = typeof replay === 'string' ? await loadReplay(replay) : undefined;
    return recording ? <ReplaySession recording={recording} view='audit' /> : <ReplayUnavailable />;
  }
  return <main>
    <nav aria-label="Office" className="audit-page-nav"><a href="/">← Back to office</a></nav>
    <AuditWall originRejected={ORIGIN_REJECTED} codeRejected={CODE_REJECTED} />
  </main>;
}
