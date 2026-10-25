'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryChapter } from '../../lib/office/story';
import { OFFICE_ANCHORS, type OfficeSnapshot } from '../../lib/office/state';
import { StoryCaption } from './StoryCaption';
import './story.css';

export function StoryMode({ chapters, onChapter, onExit, onPreview, reduced, snapshot }: {
  chapters: readonly StoryChapter[]; onChapter: (index: number) => void; onExit: () => void;
  onPreview?: (preview: StoryChapter['preview']) => void; reduced: boolean; snapshot: OfficeSnapshot;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const started = useRef(Date.now());
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.focus(); }, []);
  const togglePause = useCallback(() => setPaused(value => {
    if (value) started.current = Date.now() - elapsed;
    return !value;
  }), [elapsed]);
  const chapter = chapters[index];
  const select = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(chapters.length - 1, next));
    setIndex(bounded); setElapsed(0); setFinished(false); started.current = Date.now();
    onChapter(bounded); onPreview?.(chapters[bounded]?.preview);
  }, [chapters, onChapter, onPreview]);
  useEffect(() => { if (chapter) { onChapter(0); onPreview?.(chapter.preview); } }, []);
  useEffect(() => {
    if (!chapter || paused || finished) return;
    const timer = window.setInterval(() => {
      const duration = Date.now() - started.current;
      setElapsed(duration);
      if (duration >= chapter.dwellMs) {
        if (index === chapters.length - 1) { setFinished(true); setPaused(true); }
        else select(index + 1);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [chapter, paused, finished, index, chapters.length, select]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onExit(); }
      else if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); togglePause(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); select(index - 1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); select(index + 1); }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, onExit, select, togglePause]);
  useEffect(() => {
    const pause = () => setPaused(true);
    window.addEventListener('office-story-pause', pause);
    return () => window.removeEventListener('office-story-pause', pause);
  }, []);
  if (!chapter || !chapters.length) return null;
  const progress = reduced ? (index + 1) / chapters.length : (index + Math.min(1, elapsed / chapter.dwellMs)) / chapters.length;
  return <aside ref={card} tabIndex={-1} className='story-mode' aria-label='Judge story mode' onPointerDown={event => event.stopPropagation()}>
    <div className='story-progress' role='progressbar' aria-label='Story progress' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
    <StoryCaption chapter={chapter} index={index} total={chapters.length} snapshot={snapshot} />
    {chapter.handoff && <div className='story-handoff' role='img' aria-label={`Scripted evidence folder handoff from ${OFFICE_ANCHORS[chapter.handoff[0]].name} to ${OFFICE_ANCHORS[chapter.handoff[1]].name}`}>
      <span>{OFFICE_ANCHORS[chapter.handoff[0]].name}</span><span aria-hidden='true'>▱ →</span><span>{OFFICE_ANCHORS[chapter.handoff[1]].name}</span>
    </div>}
    {chapter.preview && !onPreview && <p className='story-preview-note'>(preview only in demo mode)</p>}
    <div className='story-actions'>
      {!finished && <button onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>}
      {finished && <button onClick={() => { select(0); setPaused(false); }}>Replay</button>}
      <button onClick={() => select(index - 1)} disabled={index === 0}>Back</button>
      {!finished && <button onClick={() => select(index + 1)} disabled={index === chapters.length - 1}>Next</button>}
      <button onClick={onExit}>Skip</button>
    </div>
  </aside>;
}
