import { InboxTray } from '../../components/InboxTray';
import { inboxPresets } from '../../lib/inbox/presets';
export const metadata = { title: 'Inbox tray · Backroom' };
export default function InboxPage() {
  return <main className="inbox-page"><InboxTray presets={inboxPresets} /></main>;
}
