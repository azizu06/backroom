import type { PartyLink, PartyRole, PartyStatus } from '../demo/party';
import { viewerName } from './presence';

export type { PartyLink, PartyRole, PartyStatus };
export const PARTY_ENDPOINT = '/__party';
export const NO_PARTY: PartyStatus = { role: 'none' };
/** Sidebar pages a view-only guest may open: reading policy and what is real. Everything else acts. */
export const GUEST_PAGES: readonly string[] = ['/policy', '/real-vs-sim'];
export const guestPage = (href: string) => GUEST_PAGES.includes(href);

/** Only this office is ever shown as a join link: on a numeric address, or on a Cloudflare quick tunnel. */
function joinUrl(raw: unknown) {
  return typeof raw === 'string' && (/^http:\/\/[\d.]+:\d+\/office$/.test(raw) || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/office$/.test(raw)) ? raw : undefined;
}
export const PARTY_LINK_LABELS: Record<PartyLink['kind'], string> = { online: 'Online · any network', wifi: 'Same Wi-Fi', tailscale: 'Tailscale' };
const LINK_KINDS: readonly string[] = ['online', 'wifi', 'tailscale'];

/** Validated copy of the host's /__party reply; anything unexpected means no party (e.g. `next dev`). */
export function parsePartyStatus(raw: unknown): PartyStatus {
  if (!raw || typeof raw !== 'object') return NO_PARTY;
  const value = raw as Record<string, unknown>;
  if (value.role === 'guest') return { role: 'guest' };
  if (value.role !== 'host') return NO_PARTY;
  const url = joinUrl(value.url);
  const links = Array.isArray(value.links) ? value.links.flatMap(raw => {
    const link = raw as Record<string, unknown> | null;
    const linkUrl = joinUrl(link?.url);
    // Online links are https tunnels and the others plain local addresses; anything mixed is dropped.
    return linkUrl && LINK_KINDS.includes(String(link?.kind)) && (link?.kind === 'online') === linkUrl.startsWith('https:')
      ? [{ kind: link!.kind, url: linkUrl } as PartyLink] : [];
  }) : [];
  return { role: 'host', hosting: value.hosting === true, url, ...(links.length ? { links } : {}),
    ...(value.online === 'starting' || value.online === 'failed' ? { online: value.online } : {}),
    guests: typeof value.guests === 'number' && Number.isInteger(value.guests) && value.guests >= 0 ? value.guests : 0,
    ...(typeof value.error === 'string' ? { error: value.error } : {}) };
}

export function partyErrorText(code: string): string {
  if (code === 'PARTY_NO_LAN') return 'No Wi-Fi network found. Connect this laptop to Wi-Fi and try again.';
  if (code === 'PARTY_PORT_IN_USE') return 'This office is already open on the network (DEMO_BIND_HOST).';
  return 'Could not start hosting. Try again.';
}

/** Party names: the host is "Host"; a guest keeps its random viewer suffix ("Guest 2068"). */
export function partyName(role: PartyRole, viewerId: string): string | undefined {
  return role === 'host' ? 'Host' : role === 'guest' ? viewerName(viewerId).replace(/^Viewer/, 'Guest') : undefined;
}
