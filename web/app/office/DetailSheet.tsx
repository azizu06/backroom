'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { useModal } from './useModal';
import { OfficeChromeIcon } from '../../components/OfficeChromeIcon';

/** AJ's rounded overview sheet. Mount only while open so focus returns to its opener. `wide` fits a full page (Calls, Policy, …). */
export function DetailSheet({ title, icon = 'house', size, page, onClose, children }: {
  title: string; icon?: ComponentProps<typeof OfficeChromeIcon>['name']; size?: 'wide'; page?: string; onClose: () => void; children: ReactNode;
}) {
  const headingId = useId();
  const modal = useModal<HTMLElement>(onClose);
  return <div className='detail-sheet-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modal} className='detail-sheet' data-size={size} data-page={page} role='dialog' aria-modal='true' aria-labelledby={headingId}>
      <header className='detail-sheet-header'>
        <span className='room-icon' aria-hidden='true'>
          <OfficeChromeIcon name={icon} />
        </span>
        <h2 id={headingId}>{title}</h2>
        <button type='button' className='detail-sheet-close' onClick={onClose} aria-label={`Close ${title}`}>
          <OfficeChromeIcon name='close' />
        </button>
      </header>
      <div className='detail-sheet-body'>{children}</div>
    </section>
  </div>;
}
