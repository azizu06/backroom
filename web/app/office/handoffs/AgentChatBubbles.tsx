'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { agentChatSource, agentChatTimeline, nextAgentChatChange, sampleAgentChat, type AgentChatCue } from '../../../lib/office/agent-chat';
import { AgentChatLayout, CHAT_HEIGHT, CHAT_WIDTH } from '../../../lib/office/agent-chat-layout';
import type { HandoffTagLookup } from './HandoffLayer';
import type { HandoffPlan, HandoffStage } from '../../../lib/office/handoff-plan';
import { handoffAgentName, handoffFlag } from '../../../lib/office/handoffs';
import { ROLES } from '../../../lib/office/palette';
import { canvasTextLines } from '../../../lib/office/props/readability';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { PROP_FONT, useCanvasTexture } from '../props/useCanvasTexture';
import { useSceneTextNode } from '../props/useSceneTextNode';

function ChatPlate({ cue }: { cue: AgentChatCue }) {
  const label = `${cue.source} · ${handoffAgentName(cue.actor)}`;
  useSceneTextNode(`agent-chat-${cue.actor}-${cue.phase}`, `${label}: ${cue.text} Status: ${cue.status}`);
  const texture = useCanvasTexture(768, 384, ctx => {
    ctx.fillStyle = ROLES.background;
    ctx.beginPath(); ctx.roundRect(3, 3, 762, 350, 22); ctx.fill();
    ctx.strokeStyle = ROLES.frame; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(344, 352); ctx.lineTo(384, 382); ctx.lineTo(424, 352); ctx.fill();
    ctx.fillStyle = ROLES.text;
    ctx.font = `700 32px ${PROP_FONT}`;
    ctx.fillText(label, 28, 50);
    ctx.font = `600 44px ${PROP_FONT}`;
    canvasTextLines(cue.text, text => ctx.measureText(text).width, 712, 4)
      .forEach((line, i) => ctx.fillText(line, 28, 110 + i * 48));
    ctx.font = `700 32px ${PROP_FONT}`;
    ctx.fillText(cue.status, 28, 326);
  }, [label, cue.text, cue.status]);
  // World-sized glyphs (~13 cm) remain readable at 4 m. Depth testing lets walls hide them.
  // No scale/pop transition, including under prefers-reduced-motion.
  return <Billboard>
    <mesh name={`agent-chat:${cue.actor}:${cue.phase}`}>
      <planeGeometry args={[CHAT_WIDTH, CHAT_HEIGHT]} />
      <meshBasicMaterial map={texture} transparent depthTest depthWrite={false} toneMapped={false} />
    </mesh>
  </Billboard>;
}

/** Shares the handoff stage with the bears and folders, including its reduced-motion positions. */
export function AgentChatBubbles({ stage, reduced, connection, tag }: {
  stage: HandoffStage; reduced: boolean; connection: OfficeSnapshot['connection']; tag?: HandoffTagLookup;
}) {
  const [scripted] = useState(() => handoffFlag(window.location.search).mock);
  const source = agentChatSource(connection, scripted);
  const [active, setActive] = useState<AgentChatCue[]>([]);
  const groups = useRef(new Map<string, Group>());
  const cached = useRef<{ plan: HandoffPlan; source: string; cues: AgentChatCue[] } | null>(null);
  const shown = useRef<AgentChatCue[]>([]);
  const scratch = useRef<AgentChatCue[]>([]);
  const [layout] = useState(() => new AgentChatLayout());
  const wake = useRef<{ at: number | null; timer?: ReturnType<typeof setTimeout> }>({ at: null });
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [source, reduced, invalidate]);
  useEffect(() => () => clearTimeout(wake.current.timer), []);
  useLayoutEffect(() => {
    // Only the tag's name label duplicates the plate's header. The tag's handoff bubble (rejection evidence,
    // correction, passkey) is not duplicated by chat and stays owned by HandoffLayer, so it is never hidden here.
    // Display is independent of HandoffLayer's per-frame visibility projection.
    const hidden: { element: HTMLElement; display: string }[] = [];
    for (const cue of active) {
      const element = tag?.(cue.actor)?.querySelector<HTMLElement>(':scope > strong');
      if (!element) continue;
      hidden.push({ element, display: element.style.display });
      element.style.display = 'none';
    }
    return () => { for (const { element, display } of hidden) element.style.display = display; };
  }, [active, tag]);
  useFrame(({ camera }) => {
    const now = Date.now();
    if (cached.current?.plan !== stage.plan || cached.current.source !== source) {
      cached.current = { plan: stage.plan, source, cues: agentChatTimeline(stage.plan, source) };
    }
    const cues = cached.current.cues;
    const next = sampleAgentChat(cues, now, scratch.current);
    // Stage sampling builds a full choreography frame: do it only while chat has active cues.
    if (next.length) layout.sample(next, stage.sample(now, reduced).actors, camera);
    else layout.entries.length = 0;
    let changed = layout.entries.length !== shown.current.length;
    for (let i = 0; i < layout.entries.length; i++) {
      const entry = layout.entries[i]!;
      if (entry.cue !== shown.current[i]) changed = true;
      groups.current.get(entry.cue.actor)?.position.copy(entry.position);
    }
    if (changed) {
      shown.current = layout.entries.map(entry => entry.cue);
      setActive(shown.current);
    }
    const at = nextAgentChatChange(cues, now);
    if (at !== wake.current.at) {
      clearTimeout(wake.current.timer);
      wake.current.at = at;
      wake.current.timer = at === null ? undefined : setTimeout(() => {
        wake.current.at = null; invalidate();
      }, Math.min(2 ** 31 - 1, Math.max(0, at - Date.now()) + 5));
    }
  });
  return <group name='agent-chat'>{active.map(cue => {
    const entry = layout.entries.find(entry => entry.cue === cue);
    if (!entry) return null;
    return <group key={cue.actor}
      ref={group => { if (group) groups.current.set(cue.actor, group); else groups.current.delete(cue.actor); }}
      position={[entry.position.x, entry.position.y, entry.position.z]}>
      <ChatPlate cue={cue} />
    </group>;
  })}</group>;
}
