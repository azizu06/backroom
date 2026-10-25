import { StartWorkdayButton } from '../../components/StartWorkdayButton';
import { InboxTray } from '../../components/InboxTray';
import { inboxPresets } from '../../lib/inbox/presets';
export const metadata = { title: 'Inbox Tray · Backrooms' };
export default function InboxPage() {
  return <main className="inbox-page"><InboxTray presets={inboxPresets} actions={<StartWorkdayButton />} /></main>;
}
