'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { viewerColor, viewerName } from '../../lib/office/presence';
import {
  chatBubbles, createChatTransport, nextChatChange, pruneChat, rateLimit, receiveChat, sanitizeChatMessage, sanitizeChatText,
  type ChatBubble, type ChatEntry, type ChatPose, type ChatTransport,
} from '../../lib/office/proximity-chat';

export type ChatSendResult = 'sent' | 'empty' | 'off' | 'limited' | 'unready';
/** What PlayHud's chat box needs; built in Office so the scene can draw the same messages as bubbles. */
export interface PlayChat {
  readonly log: readonly ChatEntry[];
  readonly selfId: string;
  readonly presence: boolean;
  send(text: string): ChatSendResult;
  showCoworkers(): void;
}

function readPose(hud: { current: HTMLElement | null }): ChatPose | null {
  const data = hud.current?.dataset;
  if (data?.playerX === undefined || data.playerZ === undefined) return null;
  const pose = { x: Number(data.playerX), z: Number(data.playerZ) };
  return Number.isFinite(pose.x) && Number.isFinite(pose.z) ? pose : null;
}
function messageId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Proximity text chat while in Play with presence on. Positions come from the Play rig's data-player-*
 * attributes on `hud`: the sender's at send time and the receiver's on arrival.
 */
export function useProximityChat({ active, hud, selfId, presence, showCoworkers }: {
  active: boolean; hud: { current: HTMLElement | null }; selfId: string; presence: boolean; showCoworkers: () => void;
}): PlayChat & { bubbles: ChatBubble[] } {
  const [log, setLog] = useState<readonly ChatEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef(log);
  const transport = useRef<ChatTransport | null>(null);
  const sent = useRef<number[]>([]);
  const commit = useCallback((next: readonly ChatEntry[]) => {
    if (next === logRef.current) return;
    logRef.current = next;
    setLog(next);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!active || !selfId) return;
    const channel = createChatTransport();
    const histories = new Map<string, number[]>();
    transport.current = channel;
    const unsubscribe = channel.subscribe(raw => commit(receiveChat(logRef.current, raw, { selfId, receiver: readPose(hud), now: Date.now(), histories })));
    return () => { unsubscribe(); channel.close(); transport.current = null; commit([]); };
  }, [active, selfId, hud, commit]);

  // Wake only when a bubble ends or an entry reaches its TTL.
  useEffect(() => {
    const next = nextChatChange(log, now);
    if (next === null) return;
    const timer = window.setTimeout(() => { const at = Date.now(); commit(pruneChat(logRef.current, at)); setNow(at); }, Math.max(0, next - Date.now()) + 20);
    return () => window.clearTimeout(timer);
  }, [log, now, commit]);

  const send = useCallback((text: string): ChatSendResult => {
    const clean = sanitizeChatText(text);
    if (!clean) return 'empty';
    if (!transport.current) return 'off';
    const pose = readPose(hud);
    if (!pose) return 'unready';
    const at = Date.now();
    const limited = rateLimit(sent.current, at);
    sent.current = limited.history;
    if (!limited.allowed) return 'limited';
    const message = sanitizeChatMessage({ id: messageId(), viewerId: selfId, name: viewerName(selfId), color: viewerColor(selfId), text: clean, x: pose.x, z: pose.z, at }, at);
    if (!message) return 'empty';
    transport.current.send(message);
    commit([...pruneChat(logRef.current, at), { ...message, receivedAt: at }]);
    return 'sent';
  }, [hud, selfId, commit]);

  const bubbles = useMemo(() => chatBubbles(log, selfId, now), [log, selfId, now]);
  return { log, selfId, presence, send, showCoworkers, bubbles };
}
