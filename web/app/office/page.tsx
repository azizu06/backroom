import { officeConfig } from '../../lib/office/config';
import { inboxPresets } from '../../lib/inbox/presets';
import { LiveOffice } from './LiveOffice';
import { MockOffice } from './Office';
import { loadReplay } from '../../lib/replay/load';
import { ReplaySession, ReplayUnavailable } from '../../components/ReplaySession';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Office · Backroom' };
export default async function OfficePage({ searchParams }: { searchParams: Promise<{ replay?: string | string[] }> }) {
  const { replay } = await searchParams;
  if (replay !== undefined) {
    const recording = typeof replay === 'string' ? await loadReplay(replay) : undefined;
    return recording ? <ReplaySession recording={recording} view='office' /> : <ReplayUnavailable />;
  }
  const config = officeConfig(process.env);
  return <main>{config ? <LiveOffice config={config} presets={inboxPresets} /> : <MockOffice />}</main>;
}
