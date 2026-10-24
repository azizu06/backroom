import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { createRequire } from 'node:module';
import { AskWhyVoice } from '../../components/AskWhyVoice';
import { LiveOffice } from '../../app/office/LiveOffice';
import { MockOffice, Office } from '../../app/office/Office';
import { createMockOfficeState } from './preview';

// web/ has no @types/react-dom; type the one server renderer used here.
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
// web/ compiles TSX with the classic runtime under vitest; Next uses its own transform.
Object.assign(globalThis, { React });

function lobby(html: string) {
  const start = html.indexOf("id=\"office-audit-wall\"");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}
function expectLobby(html: string) {
  const section = lobby(html);
  expect(section).toContain('data-office-mount="audit-wall"');
  expect(section).toContain('data-office-mount="audit-wall-live"');
  expect(section).toContain('class="audit-wall"');
  // No `recording`: the wall polls /api/audit/entries instead of showing a replay.
  expect(section).toContain('Every action leaves a record.');
  expect(section).toContain('Loading audit records');
  expect(section).not.toContain('REPLAY');
  expect(section).toContain('data-office-mount="ask-why"');
  expect(section).toContain('aria-label="Ask why by voice"');
  expect(section).toContain('Hold to ask why');
  // The snapshot.audit receipt list is gone.
  expect(section).not.toContain('Preview receipts');
  expect(section).not.toContain('Subscribed receipts');
  expect(section).not.toContain('data-audit-id=');
}

describe('office lobby', () => {
  it('mounts the live audit wall and ask-why in the preview office', () => {
    const html = renderToStaticMarkup(createElement(MockOffice));
    expect(html).toContain('class="office-toolbar"');
    expect(html).toContain('data-testid="office-viewport"');
    expect(html).toContain('class="office-footer"');
    expect(html).toContain('class="seat-statuses"');
    expect(html).toContain('class="mock-controls"');
    expectLobby(html);
  });

  it('mounts the live audit wall and ask-why in the live office, beside the inbox tray', () => {
    const html = renderToStaticMarkup(createElement(LiveOffice, { config: { uri: 'ws://127.0.0.1:1', database: 'lobby-test' }, presets: [] }));
    expectLobby(html);
    expect(html).toContain('data-office-mount="inbox"');
    expect(html.indexOf('id="office-audit-wall"')).toBeLessThan(html.indexOf('id="office-inbox-tray"'));
  });

  it('keeps the receipt fallback for callers without a wall (replay)', () => {
    const html = renderToStaticMarkup(createElement(Office, { source: createMockOfficeState().source }));
    expect(lobby(html)).toContain('Lobby audit wall');
    expect(html).not.toContain('class="audit-wall"');
    expect(html).not.toContain('data-office-mount="ask-why"');
  });

  it('keeps the AskWhyVoice default label', () => {
    expect(renderToStaticMarkup(createElement(AskWhyVoice))).toContain('aria-label="Ask why"');
  });
});
