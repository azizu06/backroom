'use client';

import { HandoffLayer } from '../handoffs/HandoffLayer';
import { AgentChatBubbles } from '../handoffs/AgentChatBubbles';
import { useHandoffPresentation } from '../handoffs/HandoffPresentation';
import type { SceneMountProps } from './types';

export function HandoffMount({ snapshot }: SceneMountProps) {
  const presentation = useHandoffPresentation();
  return snapshot.handoffs && presentation?.stage ? <>
    <HandoffLayer stage={presentation.stage} tag={presentation.tag} />
    <AgentChatBubbles stage={presentation.stage} reduced={presentation.reduced} connection={snapshot.connection} />
  </> : null;
}
