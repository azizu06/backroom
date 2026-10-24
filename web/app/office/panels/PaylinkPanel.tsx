import PaymentLinkPanel from '../../../components/PaymentLinkPanel';
import type { PlayPanelView } from './types';

/** PaymentLinkPanel brings its own h2, so the kiosk title is not a second peer heading. */
export const paylinkPanel: PlayPanelView = {
  ownHeading: true,
  hideAudit: true,
  hideAskWhy: true,
  Body: () => <PaymentLinkPanel />,
};
