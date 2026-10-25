'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { DEMO_GUIDE_STEPS, OFFICE_SHORTCUTS } from '../../lib/office/guide';
import { helpAnchorScrollTop } from '../../lib/office/help-anchors';

type Entry = { term: string; detail: string; href?: string };

const GETTING_AROUND: readonly Entry[] = [
  { term: 'Play (First Person)', detail: 'Walk the floor yourself. WASD or arrow keys to move, E to talk to an agent or inspect a desk, Esc to leave.' },
  { term: 'Orbit Camera', detail: 'The overhead view. Drag to look around; click a room label for its badge and limits.' },
  { term: 'Floor Plan', detail: 'A flat 2D map of the same live state, for small screens or when 3D is unavailable.' },
  { term: 'Tour', detail: 'The camera visits each room on its own. Any key or click stops it.' },
  { term: 'Story Mode', detail: 'A guided walkthrough of the key moments, chapter by chapter (←/→ to move, Esc to exit).' },
  { term: 'Full Screen', detail: 'The square button top right of the scene. Hides the sidebar and top bar; the camera picker and status chips stay at the top left.' },
  { term: 'Watch a recorded session', detail: 'Play the bundled offline recording in the office. No live calls or model requests.', href: '/office?replay=core-offline' },
  { term: 'Sidebar Groups', detail: 'Pages are grouped by job: Calls (place a call, then the payment link), Approvals (Dana’s Controller and the badge Policy), Attack Lab, and Setup (Operator and System Status). Each opens over the office with tabs; everything stays on this one page.' },
];

const FLOWS: readonly { title: string; steps: readonly string[] }[] = [
  { title: 'A Collections Call', steps: [
    'Unlock office calls with the operator code (Calls).',
    'Press Request call on the Collections desk phone. Alex says it is an AI before anything else.',
    'If the client asks for more than Alex’s badge allows, Alex carries the evidence folder to Dana’s desk.',
    'Dana approves or denies on the Controller with her passkey; Alex relays the answer on the same call.',
    'An approved plan creates a payment link. Paying it posts a deposit that the Reconciler matches.',
  ] },
  { title: 'An Invoice or Email in the Inbox', steps: [
    'Drop an item in the Inbox tray (or press Start the workday).',
    'Intake sorts it, Extractor reads the fields, Vendor verifies the sender, Payables checks policy.',
    'Anything risky, like a changed bank account, is held and walked to Dana.',
    'The Auditor writes a receipt to the Audit Wall for every decision.',
  ] },
];

const GLOSSARY: readonly Entry[] = [
  { term: 'Agent / Seat', detail: 'An AI clerk at a desk: Alex (Collections), Sam (Payables), Jules (Vendor Desk). Behind them run the Intake, Extractor, Vendor verifier, Reconciler and Auditor roles.' },
  { term: 'Dana', detail: 'Dana Reyes, owner of Northfield Studio and the controller. The only person who approves anything; the Treasury room is hers alone.' },
  { term: 'Badge', detail: 'The limits a seat may accept on its own, for example at most 2 installments, at least 50% first, within 30 days, no fee waivers. Click a room to see its exact badge.' },
  { term: 'Escalation (▱ Folder)', detail: 'A request outside the badge. The agent carries the evidence folder to Dana’s desk and waits for her decision.' },
  { term: 'Policy Decision', detail: 'ALLOW, DENY or ESCALATE. Decided by code, never by the model, and always recorded with the rule ids that applied.' },
  { term: 'Rule IDs', detail: 'Short names for the rule that fired, such as FEES_NON_WAIVABLE, MAX_INSTALLMENTS, OVER_LIMIT or BANK_CHANGE_HOLD.' },
  { term: 'Passkey / Approval Card', detail: 'Dana confirms each decision on her own device with a passkey (Controller). Approvals never come from a voice or a model.' },
  { term: 'Audit Wall / Receipt', detail: 'Every decision in the run: who decided, under which rule, and the outcome. Receipts are linked, so a gap or edit shows as broken.' },
  { term: 'Ask Why', detail: 'Ask the audit wall why something happened; the answer is grounded in the receipts, not guessed.' },
  { term: 'Inbox Tray', detail: 'Where invoices and emails arrive. Their contents are data, never instructions to the agents.' },
  { term: 'Bank-Change Hold', detail: 'A request to pay a vendor at a new account is held until Vendor Desk verifies it and Dana approves. The seat that verifies is never the seat that pays.' },
  { term: 'Lookalike Domain', detail: 'A sender address one character off the real vendor (acme-supp1y.com). Checked by code, not by the model.' },
  { term: 'Attack Lab: Scripted vs Live', detail: 'Scripted runs deterministic stand-in agents with no model calls; Live sends your text through the real model-backed agents (when the server allows it). Policy decides the same way in both.' },
  { term: 'Payment Link', detail: 'The one-time link created after Dana approves a plan. It lights up as “ready” in the sidebar.' },
  { term: 'Reconciliation', detail: 'The Reconciler matches a bank deposit to the invoice and plan it pays.' },
  { term: 'Operator Code / Owner PIN', detail: 'The operator code unlocks the desk phone, audit wall and policy editor for eight hours; it never approves a payment. The owner PIN unlocks only the policy editor.' },
  { term: 'Models On / Off', detail: 'The model switch in the top bar. Off pauses model work; the code rules, the record and approvals keep working.' },
  { term: 'Verified / Local / Unverified', detail: 'System Status labels: a live check or saved receipt, running in this process instead of the provider, or no fresh evidence.' },
  { term: 'Start the Workday', detail: 'Runs three seeded invoices and one bank-change attack through the real agents. No payments are made.' },
  { term: 'GX10', detail: 'The team’s on-site GPU server for routine model work. Visit the server room for live tokens per second.' },
  { term: 'Replay', detail: 'A recorded run played back in the office. No live calls or model requests are made.' },
  { term: 'Call Guardrails', detail: 'The agent discloses it is an AI, calls businesses only, within calling hours, honors opt-outs and stops on bankruptcy, and confirms identity before naming an amount.' },
];

const matches = (query: string, ...texts: string[]) => !query || texts.some(text => text.toLowerCase().includes(query));

/** Help: one place for how to get around, the main flows, a glossary and the keyboard shortcuts. */
export function HelpSheet() {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const help = root.current;
    const header = help?.closest('.detail-sheet')?.querySelector<HTMLElement>('.detail-sheet-header');
    if (!help || !header) return;
    const measure = () => help.style.setProperty('--help-header-height', `${header.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const jumpTo = (id: string) => {
    const sheet = root.current?.closest<HTMLElement>('.detail-sheet');
    const heading = root.current?.querySelector<HTMLElement>(`#${id}`);
    const navigation = root.current?.querySelector<HTMLElement>('.help-navigation');
    const header = sheet?.querySelector<HTMLElement>('.detail-sheet-header');
    if (!sheet || !heading || !navigation || !header) return;
    const top = helpAnchorScrollTop({
      scrollTop: sheet.scrollTop,
      headingTop: heading.getBoundingClientRect().top,
      scrollportTop: sheet.getBoundingClientRect().top + sheet.clientTop,
      headerHeight: header.offsetHeight,
      navigationHeight: navigation.offsetHeight,
      maxScrollTop: sheet.scrollHeight - sheet.clientHeight,
    });
    heading.focus({ preventScroll: true });
    sheet.scrollTo({ top, behavior: 'instant' });
  };
  const q = query.trim().toLowerCase();
  const around = GETTING_AROUND.filter(entry => matches(q, entry.term, entry.detail));
  const glossary = GLOSSARY.filter(entry => matches(q, entry.term, entry.detail));
  const tries = DEMO_GUIDE_STEPS.filter(step => matches(q, step.title, step.detail));
  const flows = FLOWS.filter(flow => matches(q, flow.title, ...flow.steps));
  const shortcuts = OFFICE_SHORTCUTS.filter(shortcut => matches(q, shortcut.action, ...shortcut.keys));
  const empty = !around.length && !glossary.length && !tries.length && !flows.length && !shortcuts.length;
  return <div className='help-sheet' ref={root}>
    <div className='help-navigation'>
      <label className='help-search'><span className='visually-hidden'>Search help</span>
        <input type='search' value={query} onChange={event => setQuery(event.target.value)} placeholder='Search help: badge, passkey, escalation…' />
      </label>
      <nav className='help-anchors' aria-label='Help sections'>
        {[
          { id: 'help-around', label: 'Getting Around', count: around.length },
          { id: 'help-flows', label: 'Flows', count: flows.length },
          { id: 'help-try', label: 'Things to Try', count: tries.length },
          { id: 'help-glossary', label: 'Glossary', count: glossary.length },
          { id: 'help-keys', label: 'Shortcuts', count: shortcuts.length },
        ].map(section => <button key={section.id} type='button' disabled={!section.count} onClick={() => jumpTo(section.id)}>{section.label}</button>)}
      </nav>
    </div>
    {empty && <p role='status'>Nothing matches “{query}”.</p>}
    {!!around.length && <section aria-labelledby='help-around'><h3 id='help-around' tabIndex={-1}>Getting Around</h3>
      <dl className='help-terms'>{around.map(entry => <div key={entry.term}>
        <dt>{entry.href ? <a href={entry.href}>{entry.term}</a> : entry.term}</dt>
        <dd>{entry.detail}</dd>
      </div>)}</dl>
    </section>}
    {!!flows.length && <section aria-labelledby='help-flows'><h3 id='help-flows' tabIndex={-1}>How Things Flow</h3>
      <div className='help-flows'>{flows.map(flow => <div key={flow.title}><h4>{flow.title}</h4><ol className='sheet-steps help-steps'>{flow.steps.map(step => <li key={step}>{step}</li>)}</ol></div>)}</div>
    </section>}
    {!!tries.length && <section aria-labelledby='help-try'><h3 id='help-try' tabIndex={-1}>Things to Try</h3>
      <dl className='help-terms'>{tries.map(step => <div key={step.id}><dt>{step.title}</dt><dd>{step.detail}</dd></div>)}</dl>
    </section>}
    {!!glossary.length && <section aria-labelledby='help-glossary'><h3 id='help-glossary' tabIndex={-1}>Glossary</h3>
      <dl className='help-terms'>{glossary.map(entry => <div key={entry.term}><dt>{entry.term}</dt><dd>{entry.detail}</dd></div>)}</dl>
    </section>}
    {!!shortcuts.length && <section aria-labelledby='help-keys'><h3 id='help-keys' tabIndex={-1}>Keyboard Shortcuts</h3>
      <dl className='help-keys'>{shortcuts.map((shortcut, index) => <div key={`${shortcut.action}-${index}`}><dt>{shortcut.keys.map(key => <kbd key={key}>{key}</kbd>)}</dt><dd>{shortcut.action}</dd></div>)}</dl>
    </section>}
  </div>;
}
