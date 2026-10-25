'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TALK_CHIPS, chipForKey, talkReply, type AgentTalk, type TalkChip, type TalkLine } from '../../../lib/office/agent-talk';
import type { PlayPanel } from '../../../lib/office/play';
import { agentCues, cueKeyFor } from '../../../lib/office/agent-motion';
import { HandoffText } from '../handoffs/HandoffText';
import { HandoffRecord } from './HandoffPanel';
import type { PlayPanelView } from './types';

/** The projected name tag over the speaker (Office.tsx agent tags, HandoffTags for the handoff team). */
function tagSelector(talk: AgentTalk): string {
  const { tag } = talk.speaker;
  return tag.kind === 'agent' ? `[data-agent-tag="${tag.id.replace(/["\\]/g, '\\$&')}"]` : `[data-handoff-actor="${tag.actor.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * The agent's current line, drawn in the floating name tag the scene already projects over that agent.
 * Static text in an existing projected element: no extra frames, nothing animates.
 */
function SpeechBubble({ talk, line }: { talk: AgentTalk; line: TalkLine }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const selector = tagSelector(talk);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(selector)); }, [selector]);
  if (!host) return null;
  return createPortal(<p className='handoff-bubble agent-talk-bubble' data-tone={line.tone}><HandoffText text={line.text} /></p>, host);
}

function Said({ line }: { line: TalkLine }) {
  return <><HandoffText text={line.text} />{line.ruleIds.length > 0 && <> <span className='agent-talk-rules'>{line.ruleIds.join(', ')}</span></>}
    {line.receiptIds.length > 0 && <> <span className='agent-talk-receipt'>Receipt <code>{line.receiptIds.join(', ')}</code></span></>}</>;
}

function AgentTalkBody({ panel, askWhy }: { panel: PlayPanel; askWhy?: (question?: string) => void }) {
  const talk = panel.talk;
  const root = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<TalkChip>();
  const name = talk?.speaker.name;
  useEffect(() => { setChip(undefined); }, [name]);
  // A question gets a short thinking beat from the speaker's bear before it settles back to listening.
  const speaker = talk ? cueKeyFor(talk.speaker.tag) : null;
  useEffect(() => { if (chip && speaker) agentCues.think(speaker); }, [chip, speaker]);
  useEffect(() => {
    const dialog = root.current?.closest<HTMLElement>('[role=dialog]');
    if (!dialog) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const picked = chipForKey(event.key);
      if (!picked) return;
      event.preventDefault();
      setChip(picked);
    }
    dialog.addEventListener('keydown', onKey);
    return () => dialog.removeEventListener('keydown', onKey);
  }, []);
  if (!talk) return null;
  const reply = chip ? talkReply(talk, chip) : undefined;
  const current = reply ?? talk.greeting;
  return <div ref={root} className='agent-talk'>
    <div className='agent-talk-who'>
      <span className='agent-talk-portrait' style={{ background: talk.speaker.color }} aria-hidden='true'>{talk.speaker.name.slice(0, 1).toUpperCase()}</span>
      <p><strong>{talk.speaker.name}</strong><br /><span className='agent-talk-role'>{talk.speaker.role}</span></p>
    </div>
    <p className='agent-talk-line' data-tone={talk.greeting.tone}>“<Said line={talk.greeting} />”</p>
    {talk.lines.length > 0 && <ol className='agent-talk-recent' aria-label={`What ${talk.speaker.name} did lately`}>
      {talk.lines.map(line => <li key={line.id} data-tone={line.tone}><Said line={line} /></li>)}
    </ol>}
    <div className='agent-talk-chips' role='group' aria-label='Quick replies (keys 1, 2, 3)'>
      {TALK_CHIPS.map((option, i) => <button key={option.id} type='button' aria-pressed={chip === option.id}
        aria-keyshortcuts={String(i + 1)} onClick={() => setChip(option.id)}><kbd>{i + 1}</kbd> {option.label}</button>)}
    </div>
    <p className='agent-talk-reply' aria-live='polite' data-tone={reply?.tone}>
      {chip && reply && <><span className='agent-talk-asked'>{TALK_CHIPS.find(option => option.id === chip)!.label}</span><br /><Said line={reply} /></>}
    </p>
    {askWhy && <button className='play-panel-ask' onClick={() => askWhy(talk.askWhy)}>Ask why</button>}
    {panel.handoff && <details className='agent-talk-record'><summary>Handoff record</summary><HandoffRecord panel={panel} /></details>}
    {!panel.handoff && panel.kind === 'handoff' && <HandoffRecord panel={panel} />}
    <SpeechBubble talk={talk} line={current} />
  </div>;
}

/** Talking to a seated agent or a handoff-team figure: a conversation, not a dashboard. */
export const agentTalkPanel: PlayPanelView = { Body: AgentTalkBody, hideAudit: true, hideAskWhy: true };
