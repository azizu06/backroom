import { describe, expect, it } from 'vitest';
import { createBroadcastPresence, createNoopPresence, ghostPeers, presencePeers, viewerColor, viewerName, type PresencePeer } from './presence';

describe('office presence', () => {
  it('filters, sanitizes, expires and deduplicates peers', () => {
    const peers = presencePeers([
      { viewerId: 'a', name: 'old', color: '#ffffff', x: -99, z: 0, yaw: 0, mode: 'play', at: 1000 },
      { viewerId: 'a', name: 'New\nname', color: '#112233', x: 2, z: 3, yaw: 1, mode: 'overview', at: 2000 },
      { viewerId: 'self', name: 'Self', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at: 2000 },
      { viewerId: 'expired', name: 'Gone', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at: 1 },
    ], 'self', 2500, 1000);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ name: 'Newname', x: 2, at: 2000 });
  });
  it('uses a broadcast transport with an injected fake channel and stable identity helpers', () => {
    const handlers: ((event: { data: unknown }) => void)[] = [];
    const sent: unknown[] = [];
    const channel = { postMessage: (value: unknown) => sent.push(value), addEventListener: (_: 'message', fn: (event: { data: unknown }) => void) => handlers.push(fn), removeEventListener: () => {}, close: () => {} };
    const t = createBroadcastPresence('test', channel, () => 1000);
    let peers: unknown[] = [];
    t.subscribe(value => { peers = value; });
    t.publish({ viewerId: 'me', name: 'Me', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at: 1000 });
    handlers[0]!({ data: { viewerId: 'other', name: 'Other', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at: 1000 } });
    expect(sent).toHaveLength(1); expect(peers).toHaveLength(1);
    expect(viewerName('abcd-3f2a')).toBe('Viewer 3F2A'); expect(viewerColor('abc')).toBe(viewerColor('abc'));
    expect(createNoopPresence()).toBeDefined();
  });
  it('keeps only the newest 32 viewers and prunes expired messages on reads', () => {
    const handlers: ((event: { data: unknown }) => void)[] = [];
    let now = 1000;
    const channel = { postMessage: () => {}, addEventListener: (_: 'message', fn: (event: { data: unknown }) => void) => handlers.push(fn), removeEventListener: () => {}, close: () => {} };
    const transport = createBroadcastPresence('test', channel, () => now);
    let peers: PresencePeer[] = [];
    transport.subscribe(value => { peers = value; });
    const send = (viewerId: string, at: number) => handlers[0]!({ data: { viewerId, name: viewerId, color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at } });
    send('viewer-1', now);
    send('viewer-1', now + 1);
    expect(peers.find(peer => peer.viewerId === 'viewer-1')?.at).toBe(now + 1);
    for (let i = 2; i <= 33; i++) send(`viewer-${i}`, now + i);
    expect(peers).toHaveLength(12);
    now += 20_000;
    transport.subscribe(value => { peers = value; });
    expect(peers).toEqual([]);
    transport.close();
  });
  it('only renders play-mode peers as ghosts', () => {
    const peers = presencePeers([
      { viewerId: 'a', name: 'A', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'play', at: 1000 },
      { viewerId: 'b', name: 'B', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'overview', at: 1000 },
      { viewerId: 'c', name: 'C', color: '#ffffff', x: 0, z: 0, yaw: 0, mode: 'tour', at: 1000 },
    ], '', 1000);
    expect(ghostPeers(peers).map(peer => peer.viewerId)).toEqual(['a']);
  });
});
