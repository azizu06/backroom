import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { createRequire } from 'node:module';
import { AskWhyVoice, askWhyErrorMessage, askWhyTextLocked } from '../../components/AskWhyVoice';
import { AuditWall, type AuditSnapshot } from '../../components/AuditWall';
import { LiveOffice } from '../../app/office/LiveOffice';
import { MockOffice, Office } from '../../app/office/Office';
import { RoomInspector } from '../../app/office/RoomInspector';
import { focusAskWhy } from '../../app/office/PlayHud';
import { createMockOfficeState } from './preview';
import { INITIAL_OFFICE } from './state';
import { INITIAL_VIEWPORT } from './view';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect), useSyncExternalStore: vi.fn(actual.useSyncExternalStore) };
});

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
  expect(section).toContain('<h3 id="audit-title">Audit Wall</h3>');
  // No `recording`: the wall polls /api/audit/entries instead of showing a replay.
  expect(section).toContain('Every decision in this run');
  expect(section).toContain('Loading audit records');
  expect(section).not.toContain('REPLAY');
  expect(section).toContain('data-office-mount="ask-why"');
  expect(section).toContain('aria-label="Ask why by voice"');
  expect(section).toContain('Hold to ask why');
  // The snapshot.audit receipt list is gone.
  expect(section).not.toContain('Walkthrough receipts');
  expect(section).not.toContain('Subscribed receipts');
  expect(section).not.toContain('data-audit-id=');
}

// SSR does not run click handlers. Select the fourth null state (Office's sheet)
// after the handoff mock, room focus and inspector, leaving every other hook real.
function renderSheet(node: ReactElement, sheet: 'overview' | 'rooms' | 'audit' | 'inbox') {
  const useState = vi.mocked(React.useState).getMockImplementation()! as typeof React.useState;
  let nullStates = 0;
  vi.mocked(React.useState).mockImplementation(((initial: unknown) =>
    useState(initial === null && ++nullStates === 4 ? sheet : initial)) as typeof React.useState);
  try { return renderToStaticMarkup(node); }
  finally { vi.mocked(React.useState).mockImplementation(useState); }
}

describe('office lobby', () => {
  it('routes Ask why to the audit sheet before looking up its field outside Play', () => {
    const useState = vi.mocked(React.useState).getMockImplementation()! as typeof React.useState;
    const useEffect = vi.mocked(React.useEffect).getMockImplementation()!;
    const effects: React.EffectCallback[] = [];
    const setSheet = vi.fn();
    let nullStates = 0;
    vi.mocked(React.useState).mockImplementation(((initial: unknown) => {
      const state = useState(initial);
      return initial === null && ++nullStates === 4 ? [state[0], setSheet] : state;
    }) as typeof React.useState);
    vi.mocked(React.useEffect).mockImplementation((effect, deps) => {
      if (deps?.length === 1 && deps[0] === INITIAL_VIEWPORT.mode) effects.push(effect);
    });
    const cleanup: (() => void)[] = [];
    const field = { focus: vi.fn() };
    const mount = { scrollIntoView: vi.fn(), querySelector: (selector: string) => selector.startsWith('button') ? field : null };
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { querySelector: vi.fn(() => {
      // focusAskWhy performs this query immediately after dispatch, without waiting a frame.
      expect(setSheet).toHaveBeenCalledWith('audit');
      return mount;
    }) });
    try {
      renderToStaticMarkup(createElement(MockOffice));
      vi.mocked(React.useState).mockImplementation(useState);
      vi.mocked(React.useEffect).mockImplementation(useEffect);
      for (const effect of effects) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
      focusAskWhy();
      expect(document.querySelector).toHaveBeenCalledWith("[data-office-mount='ask-why']");
      expect(field.focus).toHaveBeenCalledWith({ preventScroll: true });
      expectLobby(renderSheet(createElement(MockOffice), 'audit'));
    } finally {
      for (const dispose of cleanup) dispose();
      vi.mocked(React.useState).mockImplementation(useState);
      vi.mocked(React.useEffect).mockImplementation(useEffect);
      vi.unstubAllGlobals();
    }
  });

  it('opens the live audit wall and ask-why in AJ’s preview audit sheet', () => {
    const html = renderSheet(createElement(MockOffice), 'audit');
    expect(html).toContain('class="office-toolbar"');
    expect(html.match(/data-testid="office-topbar"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Office navigation"');
    expect(html).toContain('aria-label="Office shortcuts"');
    expect(html.match(/id="office-view"/g)).toHaveLength(1);
    // The old Guide popover is gone; its steps live in the sidebar's Help sheet.
    expect(html).not.toContain('office-guide-trigger');
    expect(html).toContain('aria-label="Help"');
    expect(html).toContain('Story Mode');
    expect(html).not.toContain('office-drawer');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('/office-chrome.svg#audit');
    expectLobby(html);
  });

  it('opens Full Floor summary with statuses, handoffs and preview controls', () => {
    const html = renderSheet(createElement(MockOffice), 'overview');
    expect(html).toContain('Today at Backroom');
    expect(html).toContain('class="seat-statuses"');
    expect(html).toContain('data-office-mount="handoffs"');
    expect(html).toContain('class="mock-controls"');
    expect(html).toContain('Show escalation');
    expect(html).not.toContain('office-drawer');
  });

  it('opens the source Rooms picker with every visible room and no replacement map', () => {
    // Render the subscribed preview rather than the deliberately empty SSR hydration snapshot.
    const useStore = vi.mocked(React.useSyncExternalStore).getMockImplementation()!;
    vi.mocked(React.useSyncExternalStore).mockImplementation((subscribe, getSnapshot, getServerSnapshot) =>
      useStore(subscribe, getSnapshot, () => { const server = getServerSnapshot?.(); return server === INITIAL_OFFICE ? getSnapshot() : server; }));
    try {
      const html = renderSheet(createElement(MockOffice), 'rooms');
      expect(html).toContain('class="room-picker"');
      expect(html).toContain('aria-label="Room camera presets"');
      for (const name of ['Lobby', 'Collections', 'Payables', 'Vendor Desk', 'Dana’s Desk', 'Treasury · Locked']) expect(html).toContain(name);
      expect(html).toContain('/office-chrome.svg#rooms');
      expect(html).not.toContain('class="overview-map"');
      expect(html).not.toContain('office-drawer');
    } finally { vi.mocked(React.useSyncExternalStore).mockImplementation(useStore); }
  });

  it('links the standalone judge inbox from the preview inspector', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const html = renderToStaticMarkup(createElement(RoomInspector, { room: 'lobby', snapshot, close: () => {} }));
    expect(html).toContain('data-office-mount="inbox-inspector"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('not synced into this scene');
    expect(html).not.toContain('href="#office-inbox-tray"');
  });

  it('opens the live office audit and inbox in separate AJ sheets', () => {
    const node = createElement(LiveOffice, { config: { uri: 'ws://127.0.0.1:1', database: 'lobby-test' }, presets: [] });
    const audit = renderSheet(node, 'audit');
    expectLobby(audit);
    expect(audit).not.toContain('data-office-mount="inbox"');
    const inbox = renderSheet(node, 'inbox');
    expect(inbox).toContain('data-office-mount="inbox"');
    expect(inbox).toContain('Subscribed intake receipts');
    expect(inbox).not.toContain('data-office-mount="audit-wall"');
    expect(inbox).toContain('/office-chrome.svg#inbox');
  });

  it('keeps the audit sheet receipt fallback for callers without a wall (replay)', () => {
    const html = renderSheet(createElement(Office, { source: createMockOfficeState().source }), 'audit');
    expect(lobby(html)).toContain('Lobby audit wall');
    expect(html).not.toContain('class="audit-wall"');
    expect(html).not.toContain('data-office-mount="ask-why"');
  });

  it('disables voice and text questions with a visible broken-chain reason', () => {
    const reason = askWhyErrorMessage(409, false, 'AUDIT_CHAIN_BROKEN');
    const html = renderToStaticMarkup(createElement(AskWhyVoice, { disabled: true, disabledReason: reason }));
    expect(html).toContain('The audit chain is broken');
    expect(html).toContain('AUDIT_CHAIN_BROKEN');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Hold to ask why<\/button>/);
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toContain('<button type="submit" disabled="">Ask why</button>');
  });

  it('explains AUDIT_CHAIN_BROKEN for both voice and text 409 responses', () => {
    for (const voice of [false, true]) {
      expect(askWhyErrorMessage(409, voice, 'AUDIT_CHAIN_BROKEN')).toBe(
        'The audit chain is broken, so ask-why is paused (AUDIT_CHAIN_BROKEN).');
    }
    expect(askWhyErrorMessage(500)).toBe('Could not answer. Try again.');
    expect(askWhyErrorMessage(503, true)).toBe('Voice is unavailable. Type your question below.');
    expect(askWhyErrorMessage(409, false, 'OTHER')).toBe('Could not answer. Try again.');
  });

  it('reports broken and recovered chains, hides the lobby text panel, and nests headings', () => {
    const onChainChange = vi.fn();
    for (const valid of [false, true]) {
      const snapshot: AuditSnapshot = {
        entries: [], measuredAt: '2026-10-24T12:00:00Z',
        chain: valid ? { valid: true, length: 0, headHash: '', firstBrokenSeq: null }
          : { valid: false, length: 0, headHash: '', firstBrokenSeq: 1, reason: 'HASH_MISMATCH' },
      };
      const render = (props: NonNullable<Parameters<typeof AuditWall>[0]>) => {
        vi.mocked(React.useState).mockImplementationOnce(() => [snapshot, vi.fn()]);
        // Static rendering does not run effects; run only the chain notification effect.
        vi.mocked(React.useEffect).mockImplementationOnce(() => {}).mockImplementationOnce(effect => { effect(); });
        return renderToStaticMarkup(createElement<NonNullable<Parameters<typeof AuditWall>[0]>>(AuditWall, props));
      };
      const lobby = render({ onChainChange, showAsk: false, headingLevel: 3 });
      expect(onChainChange).toHaveBeenLastCalledWith(valid);
      expect(lobby).toContain('<h3 id="audit-title">Audit Wall</h3>');
      expect(lobby).toContain('<h4 id="audit-records-title">Recorded actions</h4>');
      expect(lobby).not.toContain('audit-why');
      expect(lobby).not.toContain('Question about a decision');
      const audit = render({});
      expect(audit).toContain('<h1 id="audit-title">Audit Wall</h1>');
      expect(audit).toContain('<h2 id="audit-records-title">Recorded actions</h2>');
      expect(audit).toContain('<h2 id="audit-why-title">Ask why</h2>');
      expect(audit).toContain('Question about a decision');
    }
  });

  it('keeps the AskWhyVoice default label', () => {
    expect(renderToStaticMarkup(createElement(AskWhyVoice))).toContain('aria-label="Ask why"');
  });

  it('keeps the text question editable while voice arms or records', () => {
    expect(askWhyTextLocked(false, 'idle')).toBe(false);
    expect(askWhyTextLocked(false, 'arming')).toBe(false);
    expect(askWhyTextLocked(false, 'recording')).toBe(false);
    expect(askWhyTextLocked(false, 'thinking')).toBe(true);
    expect(askWhyTextLocked(true, 'idle')).toBe(true);
    expect(askWhyTextLocked(true, 'arming')).toBe(true);
    const idle = renderToStaticMarkup(createElement(AskWhyVoice));
    expect(idle).toMatch(/<input(?![^>]*disabled)[^>]*>/);
    expect(idle).toContain('<button type="submit" disabled="">Ask why</button>');
  });
});
