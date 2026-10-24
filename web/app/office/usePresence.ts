'use client';

import { useEffect, useRef, useState } from 'react';
import { createBroadcastPresence, createSpacetimePresence, presenceTransportKind, getViewerId, PRESENCE_HEARTBEAT, PRESENCE_RATE, PRESENCE_TTL, viewerColor, viewerName, type PresencePeer, type PresenceSource } from '../../lib/office/presence';
import type { OfficeSnapshot, OfficeState } from '../../lib/office/state';

/** `mode` is what this viewer is doing in first person: walking (`play`) or on the guided tour (`tour`). */
export function usePresence({ mode, hud, source, connectionMode }: { mode: 'play' | 'tour'; hud: { current: HTMLDivElement | null }; source: OfficeState & PresenceSource; connectionMode: OfficeSnapshot['connection'] }) {
  const [enabled, setEnabled] = useState(false);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const id = useRef('');
  useEffect(() => {
    id.current = getViewerId();
    setEnabled(new URLSearchParams(location.search).get('presence') === '1');
  }, []);
  useEffect(() => {
    if (!enabled) { setPeers([]); return; }
    const connection = source.getPresenceConnection?.();
    const transport = presenceTransportKind(connectionMode, connection) === 'spacetime' && connection
      ? createSpacetimePresence(connection, id.current) : createBroadcastPresence('backroom-office-presence');
    let last: PresencePeer | undefined;
    let lastAt = 0;
    let received: PresencePeer[] = [];
    const ttlValue = Number(new URLSearchParams(location.search).get('presenceTtl'));
    const ttl = Number.isFinite(ttlValue) && ttlValue > 0 ? Math.max(1000, Math.min(10_000, ttlValue)) : PRESENCE_TTL;
    const update = () => {
      const now = Date.now();
      const x = Number(hud.current?.dataset.playerX ?? -5);
      const z = Number(hud.current?.dataset.playerZ ?? 0.9);
      const yaw = Number(hud.current?.dataset.playerYaw ?? 0);
      const self: PresencePeer = { viewerId: id.current, name: viewerName(id.current), color: viewerColor(id.current), x, z, yaw, mode, at: now };
      const changed = !last || Math.hypot(self.x - last.x, self.z - last.z) > 0.12 || Math.abs(self.yaw - last.yaw) > 0.08 || self.mode !== last.mode;
      if (now - lastAt >= PRESENCE_RATE && (changed || now - lastAt >= PRESENCE_HEARTBEAT)) { transport.publish(self); last = self; lastAt = now; }
      const fresh = received.filter(peer => now - peer.at <= ttl).slice(0, 12);
      setPeers(current => current.length === fresh.length && current.every((peer, i) => peer.viewerId === fresh[i]?.viewerId && peer.at === fresh[i]?.at) ? current : fresh);
    };
    const unsubscribe = transport.subscribe(next => { received = next; update(); });
    const timer = window.setInterval(update, PRESENCE_RATE);
    update();
    return () => { window.clearInterval(timer); unsubscribe(); transport.close(); setPeers([]); };
  }, [enabled, mode, hud, source, connectionMode]);
  return { enabled, setEnabled, peers, selfName: viewerName(id.current) };
}
