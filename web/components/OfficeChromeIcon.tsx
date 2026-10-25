/** AJ's original duotone icons, vendored as an SVG sprite so the shell needs no icon dependency. */
export function OfficeChromeIcon({ name, className }: { className?: string; name: 'rooms' | 'attack' | 'controller' | 'info' | 'caret-right' | 'caret-up' | 'close' | 'house' | 'lobby' | 'collections' | 'payables' | 'vendor_onboarding' | 'dana' | 'treasury' | 'inbox' | 'audit' | 'operator' | 'sun' | 'moon' }) {
  return <svg className={className} width='1em' height='1em' viewBox='0 0 256 256' fill='currentColor' aria-hidden='true' focusable='false'>
    <use href={`/office-chrome.svg#${name}`} />
  </svg>;
}
