import { afterEach, describe, expect, it } from 'vitest';
import { GET as activeCallFeed } from '../../app/api/calls/active/route';
import { getGatewayStore, installGatewayStore } from '../gateway/runtime';
import type { GatewayStore } from '../gateway/store';

const previous = getGatewayStore();
afterEach(() => installGatewayStore(previous));

describe('desk phone feed route', () => {
  it('returns 503 when the call feed cannot be read', async () => {
    installGatewayStore({ latestVoiceCall: async () => { throw new Error('store down'); } } as unknown as GatewayStore);
    const response = await activeCallFeed();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'CALL_FEED_UNAVAILABLE' });
  });
});
