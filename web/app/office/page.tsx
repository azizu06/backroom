import { MockOffice } from './Office';
import { loadReplay } from '../../lib/replay/load';
import { ReplaySession, ReplayUnavailable } from '../../components/ReplaySession';

export default async function OfficePage({ searchParams }: { searchParams: Promise<{ replay?: string | string[] }> }) {
  const { replay } = await searchParams;
  if (replay !== undefined) {
    const recording = typeof replay === 'string' ? await loadReplay(replay) : undefined;
    return recording ? <ReplaySession recording={recording} view='office' /> : <ReplayUnavailable />;
  }
  return <main><MockOffice /></main>;
}
