import type { PlayPanelView } from './types';

/** The tray's receipts come from the default audit list; this adds the way into the existing inbox page. */
export const inboxPanel: PlayPanelView = {
  hideAskWhy: true,
  Body: () => <p><a href='/inbox'>Open the inbox tray</a></p>,
};
