import type { ComponentType } from 'react';
import type { PlayPanel } from '../../../lib/office/play';

/**
 * How PlayHud's dialog renders one Play target kind. Initial bundle: never import three, @react-three/*,
 * ../scene or ../play here. A kind without an entry gets the defaults (title heading, audit list, Ask why).
 */
export interface PlayPanelView {
  /** Rendered after the generic state/task lines. */
  /** `askWhy` hands off to the lobby's grounded ask-why flow, optionally prefilling a question. */
  readonly Body?: ComponentType<{ panel: PlayPanel; askWhy?: (question?: string) => void }>;
  /** The body brings its own h2, so the title is a plain paragraph rather than a second peer heading. */
  readonly ownHeading?: boolean;
  readonly hideAudit?: boolean;
  readonly hideAskWhy?: boolean;
}
