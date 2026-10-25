import { createElement, type ReactElement } from 'react';
import * as React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { HandoffEntries } from '../../app/office/handoffs/HandoffLog';
import { HandoffDetails } from '../../app/office/handoffs/HandoffDetails';
import { HandoffLog, HandoffPresentation, useOfficeHandoffs } from '../../app/office/handoffs/HandoffPresentation';
import { PLAY_PANEL_VIEWS } from '../../app/office/panels';
import { agentTalk } from './agent-talk';
import { handoffText } from './handoff-text';
import { handoffFromRow, handoffLine } from './handoffs';
import { planHandoffs, sampleHandoffs } from './handoff-plan';
import { playPanel } from './play';
import { INITIAL_OFFICE } from './state';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
// Match the classic TSX transform used by the existing office render tests.
Object.assign(globalThis, { React });
const row = handoffFromRow({ handoffId: 'raw-case-secret:handoff:1', decisionRef: 'raw-case-secret:decision:2', sequence: 1n,
  caseDisplayId: 'INV-42', fromAgentId: 'a', toAgentId: 'b', fromRole: 'extractor', toRole: 'vendor',
  fromVoiceRole: 'extractor', toVoiceRole: 'vendor_verifier', status: 'offered', correction: false, createdAt: 0,
  reason: 'Verify documents', summary: 'GB29 NWBK ••6819 / ••6819 / [email]', line: 'Check GB29 NWBK ••6819 for [email].',
  privateCaseId: 'PRIVATE-CASE', privatePayload: 'PRIVATE-PAYLOAD' })!;

describe('public handoff display', () => {
  it('renders the real receipt id beside the greeting', () => {
    const agent = { id: 'collections-clerk', name: 'Alex', seatId: 'collections' as const, targetAnchor: 'collections' as const, pos: [0, 0] as const, state: '' };
    const talk = agentTalk({ ...INITIAL_OFFICE, agents: [agent], audit: [{ id: 'real-audit-entry-212', agentId: agent.id, seatId: agent.seatId,
      action: 'pay', decision: 'DENY', ruleIds: [], summary: 'Payment blocked' }] }, agent.id)!;
    const html = renderToStaticMarkup(createElement(PLAY_PANEL_VIEWS.handoff!.Body!, { panel: { kind: 'handoff', title: 'Alex', entries: [], talk } }));
    const greeting = html.match(/<p class="agent-talk-line"[^>]*>(.*?)<\/p>/)?.[1];
    expect(greeting).toContain('My last receipt: Payment blocked.');
    expect(greeting).toContain('Receipt <code>real-audit-entry-212</code>');
    expect(greeting).not.toContain('audit-0');
  });

  it('mounts an empty live log before a stage exists and fills it when the first handoff arrives', () => {
    function Log({ populated }: { populated: boolean }) {
      const { presentation } = useOfficeHandoffs({ ...INITIAL_OFFICE, handoffs: populated ? [row] : [] });
      expect(!!presentation.stage).toBe(populated);
      return createElement(HandoffPresentation.Provider, { value: presentation }, createElement(HandoffLog));
    }
    const empty = renderToStaticMarkup(createElement(Log, { populated: false }));
    expect(empty).toContain('<ol role="log" aria-live="polite" aria-relevant="additions text"></ol>');
    expect(empty).toContain('No handoffs yet.');
    const populated = renderToStaticMarkup(createElement(Log, { populated: true }));
    expect(populated).toContain('<ol role="log" aria-live="polite" aria-relevant="additions text">');
    expect(populated).toContain(row.caseDisplayId);
    expect(populated).not.toContain('No handoffs yet.');
  });
  it('never includes handoffId, decisionRef or private fields in rendered HTML or panel/bubble models', () => {
    const panel = playPanel({ ...INITIAL_OFFICE, handoffs: [row] }, { kind: 'handoff', actor: 'extractor' })!;
    const bubbles = sampleHandoffs(planHandoffs([row]), 100).bubbles;
    const html = renderToStaticMarkup(createElement(HandoffEntries, { rows: [row] }))
      + renderToStaticMarkup(createElement(HandoffDetails, { handoff: panel.handoff! }))
      + renderToStaticMarkup(createElement(PLAY_PANEL_VIEWS.handoff!.Body!, { panel }));
    expect(html).toContain('aria-label="Case handoffs"');
    expect(PLAY_PANEL_VIEWS.handoff).toMatchObject({ hideAudit: true, hideAskWhy: true });
    for (const output of [html, JSON.stringify(panel), JSON.stringify(bubbles), handoffLine(row)]) {
      for (const forbidden of [row.handoffId, row.decisionRef!, 'raw-case-secret', 'PRIVATE-CASE', 'PRIVATE-PAYLOAD']) {
        expect(output).not.toContain(forbidden);
      }
      expect(output).toContain(row.caseDisplayId);
    }
    expect(html).not.toContain('data-handoff-id');
  });
  it('preserves complete masked tokens in text and non-wrapping spans without escape artifacts', () => {
    const parts = handoffText(row.summary);
    expect(parts.map(part => part.text).join('')).toBe(row.summary);
    expect(parts.filter(part => part.masked).map(part => part.text)).toEqual(['GB29 NWBK ••6819', '••6819', '[email]']);
    const html = renderToStaticMarkup(createElement(HandoffEntries, { rows: [row] }));
    for (const token of ['GB29 NWBK ••6819', '••6819', '[email]']) {
      expect(html).toContain(`<span class="handoff-token">${token}</span>`);
    }
    expect(html).not.toMatch(/&(?:bull|amp);|\\u2022/);
    expect(row.line).toBe('Check GB29 NWBK ••6819 for [email].');
  });
  it.each(['held', 'failed', 'paused'])('shows completed as neutral done even when B ended %s', outcome => {
    const done = { ...row, status: 'completed' as const, summary: `B ended ${outcome}`, completedAt: 100 };
    const panel = playPanel({ ...INITIAL_OFFICE, handoffs: [done] }, { kind: 'handoff', actor: 'vendor' })!;
    expect(panel.state).toBe('done');
    expect(panel.handoff!.status).toBe('done · Vendor verifier finished its turn');
    expect(panel.entries[0]!.decision).toBe('DONE');
    const plan = planHandoffs([done]);
    expect(plan.bubbles.every(bubble => bubble.tone === 'info' && bubble.text.includes('done · Vendor verifier finished its turn'))).toBe(true);
    expect(handoffLine(done)).not.toMatch(/success|✓|✔/i);
  });
  it('renders rejected history separately from neutral completed handoffs in the registered panel', () => {
    const done = { ...row, status: 'completed' as const, errorCode: 'STALE_ERROR', summary: 'Turn finished' };
    const rejected = { ...row, handoffId: 'rejected-private-id', sequence: 2n, status: 'rejected' as const, errorCode: 'CASE_STOPPED' };
    const panel = playPanel({ ...INITIAL_OFFICE, handoffs: [done, rejected] }, { kind: 'handoff', actor: 'vendor' })!;
    const html = renderToStaticMarkup(createElement(PLAY_PANEL_VIEWS.handoff!.Body!, { panel }));
    expect(html).toContain('<strong class="denial-text">REJECTED</strong>');
    expect(html).toContain('<strong class="">DONE</strong>');
    expect(html).toContain('CASE_STOPPED');
    expect(html).not.toContain('STALE_ERROR');
    expect(html).not.toContain(rejected.handoffId);
  });
});
