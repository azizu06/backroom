export const navLinks = [
  { label: 'Office', href: '/office' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Audit', href: '/audit' },
  { label: 'Policy', href: '/policy' },
  { label: 'Real vs Sim', href: '/real-vs-sim' },
] as const;

export function isActive(pathname: string, href: string) {
  return (pathname === '/' && href === '/office') || pathname === href || pathname.startsWith(`${href}/`);
}
