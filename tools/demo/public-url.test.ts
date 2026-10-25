import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configuredPublicOrigin, demoPublicTarget } from './public-url.ts';

describe('DEMO_PUBLIC_URL', () => {
  it('uses a valid https origin and does not start cloudflared', () => {
    assert.equal(configuredPublicOrigin('https://backroom.tail289372.ts.net'), 'https://backroom.tail289372.ts.net');
    assert.equal(configuredPublicOrigin('https://backroom.tail289372.ts.net/'), 'https://backroom.tail289372.ts.net');
    const plan = demoPublicTarget({ DEMO_PUBLIC_URL: 'https://backroom.tail289372.ts.net/' }, 3000, 'http://127.0.0.1:3000');
    assert.deepEqual(plan, { publicUrl: 'https://backroom.tail289372.ts.net', startCloudflared: false });
  });

  it('throws DEMO_PUBLIC_URL_INVALID for non-origin values', () => {
    for (const raw of ['http://backroom.tail289372.ts.net', 'https://user:pass@example.com', 'https://example.com/office', 'https://example.com?q=1', 'https://example.com#h', 'not a url', 'ftp://example.com']) {
      assert.throws(() => configuredPublicOrigin(raw), /DEMO_PUBLIC_URL_INVALID/);
    }
  });

  it('keeps the quick-tunnel default when unset', () => {
    assert.equal(configuredPublicOrigin(undefined), '');
    assert.equal(configuredPublicOrigin(''), '');
    const plan = demoPublicTarget({}, 3000, 'http://127.0.0.1:3000');
    assert.deepEqual(plan, { publicUrl: 'http://127.0.0.1:3000', startCloudflared: true });
  });
});
