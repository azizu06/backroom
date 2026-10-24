export const navLinks = [
  { label: 'Office', href: '/office' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Audit wall', href: '/audit' },
  { label: 'Attack demo', href: '/attack' },
  { label: 'Real vs simulated', href: '/real-vs-sim' },
  { label: 'Operator', href: '/operator' },
  { label: 'Controller', href: '/controller' },
] as const;

export type SiteNavPlacement = 'layout' | 'office';

export function isActive(pathname: string, href: string) {
  return (pathname === '/' && href === '/office') || pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Embeds and customer /pay/* pages stay free of internal chrome.
 * The office header draws this same bar, so the layout copy stays off `/` and `/office`
 * and does not sit above the first-person canvas.
 */
export function siteNavHidden(pathname: string, embed: string | null, placement: SiteNavPlacement = 'layout') {
  if (embed === '1') return true;
  if (pathname === '/pay' || pathname.startsWith('/pay/')) return true;
  if (placement === 'layout' && (pathname === '/' || pathname === '/office' || pathname.startsWith('/office/'))) return true;
  return false;
}
