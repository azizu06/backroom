import { requestSceneFrame } from '../../../../lib/office/frame';

/**
 * HUD variant (c): the open agent card is a DOM dialog (initial bundle) that the lazy scene pins
 * over the agent's head each rendered frame. This is the only handshake between the two; no three here.
 */
export interface AnchoredCard { readonly element: HTMLElement; readonly agentId: string }
let current: AnchoredCard | null = null;

export function anchoredCard(): AnchoredCard | null { return current; }

/** Ref callback target: pass the dialog element and agent id, or null on unmount. Requests one frame to place it. */
export function setAnchoredCard(next: AnchoredCard | null) {
  current = next;
  requestSceneFrame();
}

/** Target kinds whose dialog becomes a card over a seated agent; others keep the docked panel. */
export function anchorsToAgent(kind: string): boolean {
  return kind === 'agent';
}
