import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveOrigin, probeLive, probes } from './judge-check.mjs';

const status = { measuredAt: new Date().toISOString(), llmEnabled: true, services: { policy: { state: 'verified' } } };
const payloads = [status, { registered: true, signedIn: false }, { active: null }];

test('live health sends exactly three GETs with no credentials or redirect following', async () => {
  const requests = [];
  const result = await probeLive('https://judge.example', async (url, options) => {
    requests.push({ url, options });
    return Response.json(payloads[probes.findIndex(probe => url.endsWith(probe.path))]);
  });
  assert.deepEqual(result.map(row => row.status), ['PASS', 'PASS', 'PASS']);
  assert.deepEqual(requests.map(row => row.url), probes.map(probe => `https://judge.example${probe.path}`));
  for (const { options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { accept: 'application/json' });
    assert.equal(options.body, undefined);
  }
});

test('unregistered controller, unreachable service and malformed payment fail their own checks', async () => {
  const bad = [{ ...status, services: { claude: { state: 'unreachable' } } }, { registered: false, signedIn: false }, { active: {} }];
  const result = await probeLive('https://judge.example', async url => Response.json(bad[probes.findIndex(probe => url.endsWith(probe.path))]));
  assert.deepEqual(result.map(row => row.status), ['FAIL', 'FAIL', 'FAIL']);
});

test('public active link shape passes; expiry and non-public URLs fail', () => {
  const active = { code: 'ABCDEF1234', amountCents: 74300, expiresAt: Date.now() + 600_000,
    url: 'https://judge.example/p/ABCDEF1234', qr: 'data:image/png;base64,abc' };
  assert.match(probes[2].check({ active }), /shape valid/);
  assert.throws(() => probes[2].check({ active: { ...active, expiresAt: 0 } }));
  assert.throws(() => probes[2].check({ active: { ...active, url: 'http://localhost/p/ABCDEF1234' } }));
});

test('health errors do not echo provider bodies, URLs or credentials', async () => {
  const result = await probeLive('https://judge.example', async () => { throw new Error('https://secret:credential@provider.example'); });
  assert.ok(result.every(row => row.status === 'FAIL' && row.detail === 'Probe failed or timed out'));
});

test('only a bare HTTPS origin is accepted', () => {
  assert.equal(liveOrigin('https://judge.example/'), 'https://judge.example');
  for (const value of ['http://judge.example', 'https://user:secret@judge.example', 'https://judge.example/path', 'https://judge.example?key=secret']) {
    assert.throws(() => liveOrigin(value));
  }
});
