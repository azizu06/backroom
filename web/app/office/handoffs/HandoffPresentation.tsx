'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getHandoffAudio } from '@backroom/orchestrator/handoff-client';
import { REDUCED_MOTION_QUERY } from '../../../lib/office/a11y';
import { requestSceneFrame } from '../../../lib/office/frame';
import { FLOOR_AGENTS, HANDOFF_AGENTS, HUMAN, handoffFlag, type Handoff, type HandoffAgentId } from '../../../lib/office/handoffs';
import { createMockHandoffFeed, type HandoffFeed } from '../../../lib/office/handoff-mock';
import { HandoffStage } from '../../../lib/office/handoff-plan';
import { HandoffVoice, createAudioPlayer, unlockOnFirstGesture, liveVoiceCues } from '../../../lib/office/handoff-voice';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { HandoffEntries } from './HandoffLog';
import './handoffs.css';

const NO_HANDOFFS: readonly Handoff[] = [];
const noSubscription = () => () => {};
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/**
 * Handoff rows for the office: the subscribed snapshot's rows, or the fixture stream behind `?handoffs=mock`.
 * Returns the shared stage (null until a feed or escalation is present) and the rows.
 */
function useHandoffs(snapshot: OfficeSnapshot) {
  const [mock, setMock] = useState<{ feed: HandoffFeed; stage: HandoffStage } | null>(null);
  const [live] = useState(() => new HandoffStage());
  useEffect(() => {
    const flag = handoffFlag(window.location.search);
    if (!flag.mock) return;
    const feed = createMockHandoffFeed({ speed: flag.speed });
    setMock({ feed, stage: new HandoffStage(flag.speed) });
    feed.start();
    return () => feed.stop();
  }, []);
  const mockRows = useSyncExternalStore(mock?.feed.subscribe ?? noSubscription, mock?.feed.getRows ?? (() => NO_HANDOFFS), () => NO_HANDOFFS);
  // Explicit mock mode also works when the live public table is present but empty.
  const rows = mock ? mockRows : snapshot.handoffs ?? NO_HANDOFFS;
  const openEscalation = snapshot.agents.some(agent => !!agent.escalationId);
  // Only a feed with rows brings the handoff team onto the floor; an escalation alone leaves the base office as is.
  const stage = mock?.stage ?? (rows.length ? live : null);
  useEffect(() => { if (stage?.update(rows, Date.now(), openEscalation)) requestSceneFrame(); }, [stage, rows, openEscalation]);
  return { stage, rows };
}
/**
 * Voices for the handoff bubbles (#133). On by default after the first office gesture;
 * fatal proxy or playback errors silence them and the visuals carry on.
 */
function useHandoffVoice(rows: readonly Handoff[]) {
  const [since] = useState(Date.now);
  const [unlocked, setUnlocked] = useState(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [player] = useState(createAudioPlayer);
  const [voice] = useState(() => new HandoffVoice(line => getHandoffAudio(line), player.play, rerender));
  const unlock = useCallback(() => { player.unlock(); setUnlocked(true); }, [player]);
  useEffect(() => unlockOnFirstGesture(window, unlock), [unlock]);
  useEffect(() => () => voice.stop(), [voice]);
  useEffect(() => {
    if (!unlocked || voice.failed) return;
    for (const cue of liveVoiceCues(rows, since)) {
      if (voice.enabled) voice.say(cue);
      else voice.skip(cue.key);
    }
  }, [rows, since, unlocked, voice, voice.enabled, voice.failed]);
  return { voice, unlock };
}
function SoundToggle({ voice, unlock }: { voice: HandoffVoice; unlock: () => void }) {
  if (voice.failed) return <p className='handoff-sound' role='status'>Voices unavailable · visuals only</p>;
  return <button type='button' className='handoff-sound' aria-pressed={voice.enabled} onClick={() => { if (!voice.enabled) unlock(); voice.setEnabled(!voice.enabled); }}>
    {voice.enabled ? 'Voices on' : 'Voices off'}
  </button>;
}
function HandoffLogView({ rows, reduced, sound }: { rows: readonly Handoff[]; reduced: boolean; sound?: ReactNode }) {
  return <section className='office-audit handoff-log' aria-label='Agent handoffs' data-office-mount='handoffs'>
    <h2>Agent Handoffs <span>{reduced ? 'Reduced motion · listed instead of animated' : 'Folders passed between agent desks'}</span></h2>
    {sound}
    {/* The log stays mounted while empty so the first handoff is announced. */}
    {!rows.length && <p>No handoffs yet.</p>}
    <ol role='log' aria-live='polite' aria-relevant='additions text'>
      <HandoffEntries rows={rows} />
    </ol>
  </section>;
}

interface Presentation {
  readonly stage: HandoffStage | null;
  readonly rows: readonly Handoff[];
  readonly tag: (id: HandoffAgentId) => HTMLDivElement | undefined;
  readonly register: (id: HandoffAgentId, element: HTMLDivElement | null) => (() => void) | undefined;
  readonly handoffFor: (actor: string) => Handoff | undefined;
  readonly reduced: boolean;
  readonly voice: HandoffVoice;
  readonly unlock: () => void;
}
export const HandoffPresentation = createContext<Presentation | null>(null);
export function useHandoffPresentation() { return useContext(HandoffPresentation); }

/** One view-only stage for tags, the registered 3D mount, Play and optional voices. */
export function useOfficeHandoffs(snapshot: OfficeSnapshot) {
  const { stage, rows } = useHandoffs(snapshot);
  const { voice, unlock } = useHandoffVoice(rows);
  const projected = useMemo(() => rows === snapshot.handoffs ? snapshot : { ...snapshot, handoffs: rows }, [snapshot, rows]);
  const elements = useRef(new Map<HandoffAgentId, HTMLDivElement>());
  const tag = useCallback((id: HandoffAgentId) => elements.current.get(id), []);
  const register = useCallback((id: HandoffAgentId, element: HTMLDivElement | null) => {
    if (!element) return;
    elements.current.set(id, element);
    return () => { if (elements.current.get(id) === element) elements.current.delete(id); };
  }, []);
  const handoffFor = useCallback((actor: string) => stage?.handoffFor(actor, Date.now()), [stage]);
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
  const presentation: Presentation = { stage, rows, tag, register, handoffFor, reduced, voice, unlock };
  return { snapshot: projected, presentation };
}

/** Projected by the lazy mount; the footer log supplies the accessible version. */
export function HandoffTags() {
  const presentation = useHandoffPresentation();
  if (!presentation?.stage) return null;
  return <div className='agent-tags handoff-tags' aria-hidden='true'>{([...FLOOR_AGENTS, HUMAN] as HandoffAgentId[]).map(id => <div key={id} className='handoff-tag' data-handoff-actor={id}
    ref={element => presentation.register(id, element)}>
    <p className='handoff-bubble' hidden /><strong>{HANDOFF_AGENTS[id].name}{id === HUMAN ? ' · passkey' : ''}</strong>
  </div>)}</div>;
}

export function HandoffLog() {
  const presentation = useHandoffPresentation();
  if (!presentation) return null;
  return <HandoffLogView rows={presentation.rows} reduced={presentation.reduced} sound={<SoundToggle voice={presentation.voice} unlock={presentation.unlock} />} />;
}
