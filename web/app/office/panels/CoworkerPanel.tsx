import { requestChatDraft } from '../../../lib/office/proximity-chat';
import type { PlayPanelView } from './types';

/** "Say hi": prefills the Play chat box; sending stays in the chat box (range, rate limit). */
export const coworkerPanel: PlayPanelView = {
  hideAudit: true,
  hideAskWhy: true,
  Body: ({ panel }) => <>
    <p>Another viewer exploring the office. They are not an agent and cannot act on anything.</p>
    <button type='button' className='play-panel-ask' onClick={() => requestChatDraft(panel.greeting ?? 'Hi!')}>Say hi</button>
  </>,
};
