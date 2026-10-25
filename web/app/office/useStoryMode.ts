'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { storyChapters, type StoryChapter } from '../../lib/office/story';
import type { AnchorId } from '../../lib/office/state';
import type { ViewMode } from '../../lib/office/view';

export function useStoryMode({ rooms, storyStart, setFocus, setInspecting, setTour, pickMode }: {
  rooms: readonly AnchorId[]; storyStart: boolean;
  setFocus: (room: AnchorId | null) => void;
  setInspecting: (room: AnchorId | null) => void;
  setTour: (tour: { stops: AnchorId[]; index: number } | null) => void;
  pickMode: (mode: ViewMode) => void;
}): {
  storyActive: boolean; storyChapter: StoryChapter | undefined; reducedMotion: boolean; chapters: StoryChapter[];
  closeStory: () => void; changeStoryChapter: (index: number) => void; startStory: () => void;
  viewportRef: RefObject<HTMLDivElement | null>;
} {
  const [storyActive, setStoryActive] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const roomsKey = rooms.join(',');
  const chapters = useMemo(() => storyChapters(rooms), [roomsKey]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const closeStory = useCallback(() => {
    setStoryActive(false);
    setTour(null); setFocus(null); setInspecting(null);
    const url = new URL(window.location.href); url.searchParams.delete('demo');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [setTour, setFocus, setInspecting]);
  const changeStoryChapter = useCallback((index: number) => {
    const chapter = chapters[index]; if (!chapter) return;
    setChapterIndex(index);
    setFocus(chapter.anchor); setInspecting(null);
    setTour({ stops: chapters.map(item => item.anchor), index });
  }, [chapters, setFocus, setInspecting, setTour]);
  const startStory = useCallback(() => {
    pickMode('play'); setStoryActive(true); changeStoryChapter(0);
  }, [changeStoryChapter, pickMode]);
  useEffect(() => {
    if (!storyStart || !chapters.length || autoStarted.current) return;
    autoStarted.current = true; startStory();
  }, [storyStart, chapters.length, startStory]);
  useEffect(() => {
    if (!storyActive) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let canvas: HTMLCanvasElement | null = null;
    const pause = () => window.dispatchEvent(new CustomEvent('office-story-pause'));
    const attach = () => {
      const next = viewport.querySelector('canvas');
      if (next === canvas) return;
      canvas?.removeEventListener('pointerdown', pause);
      canvas = next;
      canvas?.addEventListener('pointerdown', pause);
    };
    const observer = new MutationObserver(attach);
    observer.observe(viewport, { childList: true, subtree: true });
    attach();
    return () => {
      observer.disconnect();
      canvas?.removeEventListener('pointerdown', pause);
    };
  }, [storyActive]);
  return { storyActive, storyChapter: storyActive ? chapters[chapterIndex] : undefined, reducedMotion, chapters, closeStory, changeStoryChapter, startStory, viewportRef };
}
