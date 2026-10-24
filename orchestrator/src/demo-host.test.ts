import { describe, it, expect } from 'vitest';
import { demoBindHost, externalState, voiceRelayPath } from '../../tools/demo/host';

describe('demo host boundary', () => {
  it('keeps the Mac private and permits the GX10 Tailscale address only when selected', () => {
    expect(demoBindHost({})).toBe('127.0.0.1');
    expect(demoBindHost({ DEMO_BIND_HOST: '100.117.44.20' })).toBe('100.117.44.20');
    for (const host of ['0.0.0.0', '::', 'gx10; false']) expect(() => demoBindHost({ DEMO_BIND_HOST: host })).toThrow('DEMO_INVALID_BIND_HOST');
  });
  it('requires explicit authenticated TLS state and never silently falls back', () => {
    expect(externalState({})).toBeUndefined();
    expect(() => externalState({ DEMO_STATE_REMOTE: '1', STATE_STORE: 'spacetime' })).toThrow('DEMO_EXTERNAL_STATE_CONFIG_REQUIRED');
    const env = { DEMO_STATE_REMOTE: '1', STATE_STORE: 'spacetime', SPACETIMEDB_URI: 'wss://maincloud.spacetimedb.com', SPACETIMEDB_DATABASE: 'judge', SPACETIMEDB_TOKEN: 'private' };
    expect(externalState(env)).toEqual({ uri: 'wss://maincloud.spacetimedb.com', database: 'judge', token: 'private' });
    expect(() => externalState({ ...env, SPACETIMEDB_URI: 'ws://example.com' })).toThrow('DEMO_EXTERNAL_STATE_REQUIRES_WSS');
  });
});

it('forwards provisioned event/tool callbacks to the authenticated receiver, preserving legacy URLs', () => {
  expect(voiceRelayPath('/api/voice/cartesia')).toBe('/api/voice/cartesia');
  expect(voiceRelayPath('/api/voice/tools/propose_plan')).toBe('/api/voice/tools/propose_plan');
  expect(voiceRelayPath('/_cartesia/health')).toBe('/health');
  for (const path of ['/api/voice/other', '/api/voice/cartesia-extra', '/api/tools/propose_plan']) expect(voiceRelayPath(path)).toBeUndefined();
});
