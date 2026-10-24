'use client';

import { HandoffLayer } from '../handoffs/HandoffLayer';
import { useHandoffPresentation } from '../handoffs/HandoffPresentation';
import type { SceneMountProps } from './types';

export function HandoffMount({ snapshot }: SceneMountProps) {
  const presentation = useHandoffPresentation();
  return snapshot.handoffs && presentation?.stage ? <HandoffLayer stage={presentation.stage} tag={presentation.tag} /> : null;
}
