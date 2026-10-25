'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { OFFICE_PANEL_TABS, officePanelCounts, type OfficePanelTab } from '../../../../lib/office/office-panels';
import type { OfficeSnapshot } from '../../../../lib/office/state';

/** Keep every body mounted: hidden tabs retain their subscriptions, forms and native scroll offsets. */
export function OfficePanels({ open, tab, select, close, snapshot, content }: {
  open: boolean; tab: OfficePanelTab; select: (tab: OfficePanelTab) => void; close: () => void;
  snapshot: OfficeSnapshot; content: Record<OfficePanelTab, ReactNode>;
}) {
  const root = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const counts = officePanelCounts(snapshot);
  useEffect(() => {
    // Ask why may already have focused its field synchronously; do not steal that focus.
    if (open && !wasOpen.current && !root.current?.contains(document.activeElement)) {
      root.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  return <footer ref={root} id='office-drawer' className='office-footer office-drawer' hidden={!open} aria-label='Office panels' onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <header className='office-drawer-head'><h2>Office Panels</h2><button type='button' onClick={close} aria-label='Close office panels'>Close</button></header>
    <div className='office-panel-tabs' role='tablist' aria-label='Office panels'>
      {OFFICE_PANEL_TABS.map((item, index) => <button key={item.id} type='button' role='tab' id={`office-tab-${item.id}`}
        aria-controls={`office-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => select(item.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % OFFICE_PANEL_TABS.length
            : event.key === 'ArrowLeft' ? (index + OFFICE_PANEL_TABS.length - 1) % OFFICE_PANEL_TABS.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? OFFICE_PANEL_TABS.length - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault(); event.stopPropagation();
          const id = OFFICE_PANEL_TABS[next]!.id;
          select(id);
          document.getElementById(`office-tab-${id}`)?.focus({ preventScroll: true });
          document.getElementById(`office-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}>{item.label} <span>{counts[item.id]}</span></button>)}
    </div>
    {OFFICE_PANEL_TABS.map(item => <div key={item.id} id={`office-panel-${item.id}`} className='office-panel-body'
      role='tabpanel' aria-labelledby={`office-tab-${item.id}`} hidden={tab !== item.id} tabIndex={0}>
      {content[item.id]}
    </div>)}
  </footer>;
}
