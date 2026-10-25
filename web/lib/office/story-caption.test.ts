import * as React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { StoryCaption } from '../../app/office/StoryCaption';
import { INITIAL_OFFICE, type OfficeSnapshot } from './state';
import { STORY_CHAPTERS } from './story';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: React.ReactElement) => string };
Object.assign(globalThis, { React });
const disclosure = 'Scripted walkthrough · illustration, not recorded decisions';
const render = (index: number, snapshot: OfficeSnapshot) => renderToStaticMarkup(React.createElement(StoryCaption, {
  chapter: STORY_CHAPTERS[index]!, index, total: STORY_CHAPTERS.length, snapshot,
}));

describe('story caption disclosure', () => {
  it('labels every chapter as scripted and reports missing live evidence', () => {
    STORY_CHAPTERS.forEach((chapter, index) => {
      const html = render(index, { ...INITIAL_OFFICE, connection: 'live' });
      expect(html).toContain(`<header class="story-disclaimer">${disclosure} · live state below is real</header>`);
      expect(chapter.caption).not.toMatch(/demo/i);
      expect(html).toContain('<p class="story-evidence">Not recorded in this session</p>');
      expect(html).toContain('aria-live="polite" aria-atomic="true">Scripted walkthrough:');
      expect(html).not.toContain('href=');
    });
  });

  it('retains the scripted disclosure outside live state without claiming a live connection', () => {
    for (const connection of ['preview', 'replay', 'connecting', 'disconnected'] as const) {
      const html = render(0, { ...INITIAL_OFFICE, connection });
      expect(html).toContain(`<header class="story-disclaimer">${disclosure}</header>`);
      expect(html).not.toContain('live state below is real');
    }
  });

  it('renders a friendly evidence label and keyboard-accessible receipt link', () => {
    const html = render(STORY_CHAPTERS.findIndex(chapter => chapter.id === 'vendor'), { ...INITIAL_OFFICE, connection: 'live', audit: [{
      id: 'audit:bank', agentId: 'jules', seatId: 'vendor_onboarding', action: 'verify_vendor',
      decision: 'ESCALATE', ruleIds: ['BANK_CHANGE_HOLD'], summary: 'Bank change held',
    }] });
    expect(html).toContain('<a href="/audit?entry=audit%3Abank#audit-replay">View receipt</a>');
    expect(html).toContain(disclosure);
  });
});
