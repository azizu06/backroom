'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
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
  storyActive: boolean; reducedMotion: boolean; chapters: StoryChapter[];
  closeStory: () => void; changeStoryChapter: (index: number) => void; startStory: () => void;
  viewportRef: RefObject<HTMLDivElement | null>;
} {
  const [storyActive, setStoryActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const chapters = storyChapters(rooms);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (storyStart && chapters.length) setStoryActive(true); }, [storyStart, chapters.length]);
  const closeStory = useCallback(() => {
    setStoryActive(false);
    const url = new URL(window.location.href); url.searchParams.delete('demo');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const changeStoryChapter = useCallback((index: number) => {
    const chapter = chapters[index]; if (!chapter) return;
    setFocus(chapter.anchor); setInspecting(null);
    setTour({ stops: chapters.map(item => item.anchor), index });
  }, [chapters, setFocus, setInspecting, setTour]);
  const startStory = useCallback(() => {
    pickMode('walk'); setStoryActive(true); changeStoryChapter(0);
  }, [changeStoryChapter, pickMode]);
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
  return { storyActive, reducedMotion, chapters, closeStory, changeStoryChapter, startStory, viewportRef };
}
