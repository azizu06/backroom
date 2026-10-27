import { expect, it } from 'vitest';
import { guestPage, parsePartyStatus, partyName } from './party';

it('accepts only well-formed host and guest replies', () => {
  expect(parsePartyStatus({ role: 'guest', url: 'http://x' })).toEqual({ role: 'guest' });
  expect(parsePartyStatus({ role: 'host', hosting: true, url: 'http://192.168.1.20:3000/office', guests: 2 }))
    .toEqual({ role: 'host', hosting: true, url: 'http://192.168.1.20:3000/office', guests: 2 });
  // A link that is not this office on a numeric address is never shown as the join link.
  expect(parsePartyStatus({ role: 'host', hosting: true, url: 'javascript:alert(1)', guests: -1 })).toEqual({ role: 'host', hosting: true, url: undefined, guests: 0 });
  expect(parsePartyStatus({ role: 'host', hosting: true, url: 'http://10.0.1.5:3300/office', guests: 0,
    links: [{ kind: 'wifi', url: 'http://10.0.1.5:3300/office' }, { kind: 'tailscale', url: 'http://100.97.81.61:3300/office' }, { kind: 'evil', url: 'http://1.2.3.4:1/office' }, { kind: 'tailscale', url: 'https://x' }] }).links)
    .toEqual([{ kind: 'wifi', url: 'http://10.0.1.5:3300/office' }, { kind: 'tailscale', url: 'http://100.97.81.61:3300/office' }]);
  expect(parsePartyStatus({ role: 'host', hosting: true, online: 'starting', guests: 0, links: [
    { kind: 'online', url: 'https://able-baker-1.trycloudflare.com/office' }, { kind: 'online', url: 'http://10.0.0.1:1/office' },
    { kind: 'wifi', url: 'https://able-baker-1.trycloudflare.com/office' }, { kind: 'online', url: 'https://evil.example/office' }] }))
    .toEqual({ role: 'host', hosting: true, url: undefined, online: 'starting', guests: 0, links: [{ kind: 'online', url: 'https://able-baker-1.trycloudflare.com/office' }] });
  expect(parsePartyStatus({ role: 'host', hosting: false, guests: 0, error: 'PARTY_NO_LAN' })).toMatchObject({ hosting: false, error: 'PARTY_NO_LAN' });
  for (const raw of [null, 'host', [], { role: 'admin' }, { status: 404 }]) expect(parsePartyStatus(raw)).toEqual({ role: 'none' });
});

it('names the host and guests, and leaves everyone else alone', () => {
  expect(partyName('host', 'abc')).toBe('Host');
  expect(partyName('guest', '1f2e-2068')).toBe('Guest 2068');
  expect(partyName('none', 'abc')).toBeUndefined();
});

it('lets guests open only the read-only sidebar pages', () => {
  expect(['/policy', '/real-vs-sim'].every(guestPage)).toBe(true);
  expect(['/calls', '/attack', '/controller', '/operator', '/payment-link'].some(guestPage)).toBe(false);
});
