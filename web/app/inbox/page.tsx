import { InboxTray } from '../../components/InboxTray';
import { inboxPresets } from '../../lib/inbox/presets';
export const metadata = { title: 'Inbox tray · Backroom' };
export default function InboxPage() {
  return <main className="inbox-page"><nav aria-label="Office"><a href="/office">← Back to office</a></nav><InboxTray presets={inboxPresets} /></main>;
}
