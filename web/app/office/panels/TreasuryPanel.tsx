import type { PlayPanelView } from './types';

export const treasuryPanel: PlayPanelView = {
  hideAudit: true,
  Body: ({ panel }) => <>
    {panel.locked && <p>{panel.locked}</p>}
    {panel.denial && <p className='denial-text' role='status' data-denial-audit={panel.denial.id}>
      <strong>{panel.denial.decision}</strong> Entry denied · rule {panel.denial.ruleIds.join(', ')} · audit <code>{panel.denial.id}</code>
    </p>}
  </>,
};
