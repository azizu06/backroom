export const navLinks = [
  { label: 'Office', href: '/office' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Audit Wall', href: '/audit' },
  { label: 'Attack Demo', href: '/attack' },
  { label: 'Operator', href: '/operator' },
  { label: 'Controller', href: '/controller' },
] as const;

/** Small trailing link to the full disclosure; replaces a top-level "Real vs simulated" item. */
export const whatsRealLink = { label: 'What’s real', href: '/real-vs-sim' } as const;

export type SiteNavPlacement = 'layout' | 'office';

export function isActive(pathname: string, href: string) {
  return (pathname === '/' && href === '/office') || pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Embeds and customer /pay/* pages stay free of internal chrome.
 * The office header draws this same bar, so the layout copy stays off `/` and `/office`.
 */
export function siteNavHidden(pathname: string, embed: string | null, placement: SiteNavPlacement = 'layout') {
  if (embed === '1') return true;
  if (pathname === '/pay' || pathname.startsWith('/pay/')) return true;
  if (placement === 'layout' && (pathname === '/' || pathname === '/office' || pathname.startsWith('/office/'))) return true;
  return false;
}
