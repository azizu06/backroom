import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS, storyChapterAt, storyChapters, storyProgress, storyTotalMs } from './story';

describe('judge story timing', () => {
  it('has seven short chapters and advances at dwell boundaries', () => {
    expect(STORY_CHAPTERS).toHaveLength(7);
    expect(STORY_CHAPTERS.every(chapter => chapter.caption.length <= 140)).toBe(true);
    expect(storyChapterAt(0)).toBe(0);
    expect(storyChapterAt(STORY_CHAPTERS[0]!.dwellMs)).toBe(1);
    expect(storyChapterAt(storyTotalMs())).toBe(6);
  });
  it('reports elapsed progress and static reduced motion', () => {
    expect(storyProgress(storyTotalMs() / 2)).toBe(0.5);
    expect(storyProgress(0, STORY_CHAPTERS, true)).toBe(1 / STORY_CHAPTERS.length);
  });
  it('skips chapters in hidden rooms', () => {
    expect(storyChapters(['lobby', 'payables']).map(chapter => chapter.anchor)).toEqual(['lobby', 'payables', 'lobby']);
  });
});
