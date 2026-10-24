'use client';

import { useEffect, useRef, useState } from 'react';
import { createBroadcastPresence, getViewerId, PRESENCE_HEARTBEAT, PRESENCE_RATE, PRESENCE_TTL, viewerColor, viewerName, type PresencePeer } from '../../lib/office/presence';
import type { ViewMode } from '../../lib/office/view';

export function usePresence({ mode, hud }: { mode: ViewMode; hud: { current: HTMLDivElement | null } }) {
  const [enabled, setEnabled] = useState(false);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const id = useRef('');
  useEffect(() => {
    id.current = getViewerId();
    setEnabled(new URLSearchParams(location.search).get('presence') === '1');
  }, []);
  useEffect(() => {
    if (!enabled) { setPeers([]); return; }
    const transport = createBroadcastPresence('backroom-office-presence');
    let last: PresencePeer | undefined;
    let lastAt = 0;
    let received: PresencePeer[] = [];
    const ttlValue = Number(new URLSearchParams(location.search).get('presenceTtl'));
    const ttl = Number.isFinite(ttlValue) && ttlValue > 0 ? Math.max(1000, Math.min(10_000, ttlValue)) : PRESENCE_TTL;
    const update = () => {
      const now = Date.now();
      const x = mode === 'play' ? Number(hud.current?.dataset.playerX ?? -5) : 0;
      const z = mode === 'play' ? Number(hud.current?.dataset.playerZ ?? 0.9) : 0;
      const yaw = mode === 'play' ? Number(hud.current?.dataset.playerYaw ?? 0) : 0;
      const self: PresencePeer = { viewerId: id.current, name: viewerName(id.current), color: viewerColor(id.current), x, z, yaw,
        mode: mode === 'play' ? 'play' : mode === 'tour' ? 'tour' : 'overview', at: now };
      const changed = !last || Math.hypot(self.x - last.x, self.z - last.z) > 0.12 || Math.abs(self.yaw - last.yaw) > 0.08 || self.mode !== last.mode;
      if (now - lastAt >= PRESENCE_RATE && (changed || now - lastAt >= PRESENCE_HEARTBEAT)) { transport.publish(self); last = self; lastAt = now; }
      const fresh = received.filter(peer => now - peer.at <= ttl).slice(0, 12);
      setPeers(current => current.length === fresh.length && current.every((peer, i) => peer.viewerId === fresh[i]?.viewerId && peer.at === fresh[i]?.at) ? current : fresh);
    };
    const unsubscribe = transport.subscribe(next => { received = next; update(); });
    const timer = window.setInterval(update, PRESENCE_RATE);
    update();
    return () => { window.clearInterval(timer); unsubscribe(); transport.close(); setPeers([]); };
  }, [enabled, mode, hud]);
  return { enabled, setEnabled, peers, selfName: viewerName(id.current) };
}
