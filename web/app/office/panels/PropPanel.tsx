import type { PlayPanelView } from './types';
import './prop.css';

export const propPanel: PlayPanelView = {
  hideAudit: true,
  hideAskWhy: true,
  Body: ({ panel }) => <>
    <p>Read-only · office snapshot</p>
    <dl className='play-prop-rows' aria-label={panel.title}>{panel.rows?.map((row, index) => <div key={`${row.label}:${index}`}>
      <dt>{row.label}</dt><dd>{row.value}</dd>
    </div>)}</dl>
  </>,
};
