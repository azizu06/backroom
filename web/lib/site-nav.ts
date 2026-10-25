/** Every page is one click away; nobody types a path. Customer /pay pages are reached from the payment link. */
export const navLinks = [
  { label: 'Office', href: '/office' },
  { label: 'Calls', href: '/calls' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Audit wall', href: '/audit' },
  { label: 'Attack lab', href: '/attack' },
  { label: 'Policy', href: '/policy' },
  { label: 'Controller', href: '/controller' },
  { label: 'Payment link', href: '/payment-link' },
  { label: 'Operator', href: '/operator' },
] as const;
export const PAYMENT_LINK_HREF = '/payment-link';

/** Small trailing link to the integration status page. */
export const whatsRealLink = { label: 'System status', href: '/real-vs-sim' } as const;

export type SiteNavPlacement = 'layout' | 'office';

export function isActive(pathname: string, href: string) {
  return (pathname === '/' && href === '/office') || pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Embeds and customer /pay/* pages stay free of internal chrome.
 * The office owns navigation in its sidebar, so the layout copy stays off `/` and `/office`.
 */
export function siteNavHidden(pathname: string, embed: string | null, placement: SiteNavPlacement = 'layout') {
  if (embed === '1') return true;
  if (pathname === '/pay' || pathname.startsWith('/pay/')) return true;
  if (placement === 'layout' && (pathname === '/' || pathname === '/office' || pathname.startsWith('/office/'))) return true;
  return false;
}
