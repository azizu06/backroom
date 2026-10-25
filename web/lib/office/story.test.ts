import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS, storyCameraPose, storyChapterAt, storyChapters, storyProgress, storyTotalMs } from './story';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { EYE_HEIGHT, PLAYER_RADIUS, insideAny, officeColliders } from './play';
import { interpolateIntroPose, playIntroProgress } from './play-intro';

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
    expect(storyChapters(['lobby', 'payables']).map(chapter => chapter.anchor)).toEqual(['lobby', 'payables', 'payables']);
  });
  it('visits the lobby, every agent desk, handoff, human approval, then Treasury DENY', () => {
    expect(STORY_CHAPTERS.map(({ id, anchor }) => [id, anchor])).toEqual([
      ['inbox', 'lobby'], ['collections', 'collections'], ['sort', 'payables'],
      ['vendor', 'vendor_onboarding'], ['handoff', 'payables'], ['dana', 'dana'], ['treasury', 'treasury'],
    ]);
    expect(STORY_CHAPTERS[5]!.caption).toContain('passkey');
    expect(STORY_CHAPTERS[4]!.handoff).toEqual(['vendor_onboarding', 'payables']);
    expect(STORY_CHAPTERS[6]!.caption).toContain('NOT_IN_BADGE');
  });
  it('resolves eye-level poses facing named anchors, clear of furniture and the vault', () => {
    const colliders = officeColliders(Object.keys(OFFICE_ANCHORS) as AnchorId[]);
    for (const { anchor } of STORY_CHAPTERS) {
      const pose = storyCameraPose(anchor);
      const [x, height, z] = pose.position;
      expect(height).toBe(EYE_HEIGHT);
      expect(insideAny([x, z], colliders, PLAYER_RADIUS)).toBe(false);
      const yaw = 2 * Math.atan2(pose.quaternion[1], pose.quaternion[3]);
      const [cx, cz] = OFFICE_ANCHORS[anchor].center;
      expect(-Math.sin(yaw)).toBeCloseTo((cx - x) / Math.hypot(cx - x, cz - z));
      expect(-Math.cos(yaw)).toBeCloseTo((cz - z) / Math.hypot(cx - x, cz - z));
    }
  });
  it('follows relocated room anchors rather than storing layout coordinates in stops', () => {
    const anchors = Object.fromEntries(Object.entries(OFFICE_ANCHORS).map(([id, room]) => [id, {
      position: [room.position[0] + 20, room.position[1] + 10] as const,
      center: [room.center[0] + 20, room.center[1] + 10] as const,
    }])) as Record<AnchorId, { position: readonly [number, number]; center: readonly [number, number] }>;
    for (const { anchor } of STORY_CHAPTERS) {
      const before = storyCameraPose(anchor), after = storyCameraPose(anchor, anchors);
      expect(after.position).toEqual([before.position[0] + 20, EYE_HEIGHT, before.position[2] + 10]);
      expect(after.quaternion).toEqual(before.quaternion);
    }
  });
  it('eases between stops and cuts directly to the named destination with reduced motion', () => {
    const from = storyCameraPose('lobby'), to = storyCameraPose('collections');
    expect(interpolateIntroPose(from, to, playIntroProgress(100, false))).not.toEqual(to);
    expect(interpolateIntroPose(from, to, playIntroProgress(0, true))).toEqual(to);
  });
});
