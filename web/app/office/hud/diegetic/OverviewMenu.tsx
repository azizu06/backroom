'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isCloseKey } from '../../../../lib/office/a11y';

export interface OverviewMenuItem { readonly id: string; readonly label: string; readonly hint?: string; readonly run: () => void }

const EDGE = 10;

/**
 * HUD variant (c): the Overview quick-action menu for an agent or desk ("Go here", "Talk", "Details").
 * Opens at the clicked point, focuses its first item, arrows move, Escape or Tab closes (the caller
 * returns focus to the opener), and a click outside closes it. View-only: every item moves the camera
 * or opens a read-only panel.
 */
export function OverviewMenu({ title, subtitle, items, at, close }: {
  title: string; subtitle?: string; items: readonly OverviewMenuItem[]; at: { x: number; y: number }; close: (restoreFocus: boolean) => void;
}) {
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const menu = root.current;
    const host = menu?.offsetParent as HTMLElement | null;
    if (!menu || !host) return;
    const left = Math.min(host.clientWidth - menu.offsetWidth - EDGE, Math.max(EDGE, at.x - menu.offsetWidth / 2));
    const below = at.y + 12;
    const top = below + menu.offsetHeight + EDGE > host.clientHeight ? Math.max(EDGE, at.y - menu.offsetHeight - 12) : below;
    setPlace({ left, top });
  }, [at.x, at.y]);
  // Transparent (not hidden) while it measures, so the first item can take focus at once.
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(); }, []);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) close(false);
    }
    // Capture, so the click that opened the menu (already handled) never closes it, and a click on the scene does.
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [close]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); buttons[(to + buttons.length) % buttons.length]?.focus(); };
    if (isCloseKey(event.key)) { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.length - 1);
  }
  return <div ref={root} className='overview-menu' role='menu' aria-labelledby={headingId} onKeyDown={onKeyDown}
    style={place ? { left: place.left, top: place.top } : { left: at.x, top: at.y, opacity: 0 }}>
    <p id={headingId} className='overview-menu-title'><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</p>
    {items.map(item => <button key={item.id} type='button' role='menuitem' data-action={item.id} onClick={item.run}>
      {item.label}{item.hint && <span className='overview-menu-hint'>{item.hint}</span>}
    </button>)}
  </div>;
}
