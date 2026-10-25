import { describe, expect, it, vi } from 'vitest';
import { drawScreen } from '../../../app/office/props/DeskMonitors';
import { drawPlate } from '../../../app/office/hud/diegetic/DeskStatusPlates';
import { drawBoard as drawNotice } from '../../../app/office/hud/diegetic/LobbyNoticeBoard';
import { drawBoard as drawWhiteboard } from '../../../app/office/props/Whiteboard';
import { ROLES } from '../palette';
import { INITIAL_OFFICE } from '../state';
import { noticeBoard } from '../hud-diegetic';
import { monitorScreen, MONITOR_TEXTURE } from './monitors';
import { whiteboardStats } from './whiteboard';

/** Deterministic canvas metrics; each painter must measure using its current, unchanged font. */
function canvas(width: number, height: number) {
  const painted: { text: string; font: string; y: number }[] = [];
  const ctx = {
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    measureText(text: string) {
      const size = Number(/(\d+)px/.exec(this.font)![1]);
      return { width: [...text].reduce((sum, char) => sum + (char === ' ' ? 0.25 : /[ilI.·]/.test(char) ? 0.25 : 0.55) * size, 0) };
    },
    fillText(text: string, x: number, y: number, maxWidth?: number) {
      expect(maxWidth, 'canvas maxWidth must never squeeze a font').toBeUndefined();
      const measured = this.measureText(text).width;
      const left = this.textAlign === 'right' ? x - measured : this.textAlign === 'center' ? x - measured / 2 : x;
      const size = Number(/(\d+)px/.exec(this.font)![1]);
      expect(left, text).toBeGreaterThanOrEqual(0);
      expect(left + measured, text).toBeLessThanOrEqual(width);
      expect(y - (this.textBaseline === 'middle' ? size / 2 : size), text).toBeGreaterThanOrEqual(0);
      expect(y + (this.textBaseline === 'middle' ? size / 2 : size * 0.2), text).toBeLessThanOrEqual(height);
      painted.push({ text, font: this.font, y });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted };
}

describe('canvas board painters', () => {
  it.each(['Jules · Checking vendor evidence', 'Alex · Reviewing invoice 1042'])('paints the full desk task across lines: %s', text => {
    const [name, state] = text.split(' · ');
    const screen = monitorScreen({ ...INITIAL_OFFICE, agents: [{ id: 'agent', name: name!, state: state!,
      seatId: 'vendor_onboarding', targetAnchor: 'vendor_onboarding', pos: [0, 0] }] }, 'vendor_onboarding');
    const { ctx, painted } = canvas(MONITOR_TEXTURE.width, MONITOR_TEXTURE.height);
    drawScreen(ctx, screen, ROLES.frame, true);
    const task = painted.filter(row => row.font.startsWith('600 36px'));
    expect(task.length).toBeGreaterThanOrEqual(1);
    if (name === 'Jules') expect(task.length).toBeGreaterThan(1);
    expect(task.map(row => row.text).join(' ')).toBe(text);
    expect(task.at(-1)!.y).toBeLessThan(260);
  });

  it.each([
    'Jules · Checking vendor evidence',
    'Alex · Reviewing invoice 1042',
    'Ask me about issues/PRs',
    'Jules · Checking vendor evidence and reviewing invoice 1042 with the team before approval',
  ])('preserves full card text across up to three lines: %s', text => {
    const { ctx, painted } = canvas(624, 320);
    drawPlate(ctx, { agentId: 'jules', title: text, line: text,
      tag: 'NEEDS YOU', colourRole: 'statusWarn', agentColour: 'lavender' });
    const title = painted.filter(row => row.font.startsWith('800 34px'));
    const detail = painted.filter(row => row.font.startsWith('600 32px'));
    for (const lines of [title, detail]) {
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(lines.map(row => row.text).join(' ')).toBe(text);
      if (text.includes('with the team')) expect(lines).toHaveLength(3);
    }
    expect(title.at(-1)!.y + 7).toBeLessThan(detail[0]!.y - 32);
    expect(detail.at(-1)!.y + 7).toBeLessThan(258);
    expect(painted.at(-1)!.text).toBe('NEEDS YOU');
  });

  it('ellipsizes only the third card line when text overflows', () => {
    const { ctx, painted } = canvas(624, 320);
    const text = 'Checking vendor evidence and reviewing invoice 1042 '.repeat(5);
    drawPlate(ctx, { agentId: 'jules', title: text, line: text,
      tag: 'WORKING', colourRole: 'screenGlow', agentColour: 'lavender' });
    for (const font of ['800 34px', '600 32px']) {
      const lines = painted.filter(row => row.font.startsWith(font));
      expect(lines).toHaveLength(3);
      expect(lines[0]!.text + lines[1]!.text).not.toContain('…');
      expect(lines[2]!.text).toMatch(/…$/);
      expect(text.startsWith(lines.map(row => row.text).join(' ').slice(0, -1))).toBe(true);
    }
  });

  it('wraps all four notice receipts above the footer', () => {
    const { ctx, painted } = canvas(760, 544);
    const summary = 'Preview · sample tickets from the office snapshot with vendor evidence';
    const audit = Array.from({ length: 4 }, (_, i) => ({ id: String(i), agentId: 'a', seatId: 'payables',
      action: 'review', decision: 'ALLOW' as const, ruleIds: [], summary }));
    drawNotice(ctx, noticeBoard({ ...INITIAL_OFFICE, audit }));
    const lines = painted.filter(row => row.font.startsWith('500 25px'));
    expect(lines).toHaveLength(8);
    for (let i = 0; i < 4; i++) expect(lines.slice(i * 2, i * 2 + 2).map(row => row.text).join(' ')).toBe(summary);
    expect(lines.at(-1)!.y + 5).toBeLessThan(505);
  });

  it('wraps each whiteboard receipt instead of truncating its data', () => {
    const { ctx, painted } = canvas(512, 285);
    const summary = 'Invoice 1042 · four installments requested → Dana for approval';
    const audit = Array.from({ length: 3 }, (_, i) => ({ id: String(i), agentId: 'a', seatId: 'payables',
      action: 'review', decision: 'ESCALATE' as const, ruleIds: [], summary }));
    drawWhiteboard(ctx, whiteboardStats({ ...INITIAL_OFFICE, audit }));
    const lines = painted.filter(row => row.font.startsWith('500 18px'));
    expect(lines).toHaveLength(6);
    for (let i = 0; i < 3; i++) expect(lines.slice(i * 2, i * 2 + 2).map(row => row.text).join(' ')).toBe(`HOLD · ${summary}`);
  });
});
