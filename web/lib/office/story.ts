import { OFFICE_ANCHORS, type AnchorId } from './state';
import { EYE_HEIGHT } from './play';
import { interpolateIntroPose, type IntroPose } from './play-intro';
import { ROOM_SPAWNS, workspaceRoute } from './layout';

export type StoryChapter = { readonly id: string; readonly anchor: AnchorId; readonly title: string; readonly caption: string; readonly dwellMs: number; readonly preview?: 'escalation' | 'denial'; readonly handoff?: readonly [from: AnchorId, to: AnchorId] };
export const STORY_CHAPTERS: readonly StoryChapter[] = [
  { id: 'inbox', anchor: 'lobby', title: 'The audit wall and inbox', caption: 'Invoices enter the inbox; the audit wall shows received decision receipts.', dwellMs: 5200 },
  { id: 'collections', anchor: 'collections', title: 'A disclosed AI call', caption: 'The caller identifies as AI, checks consent and observes calling hours.', dwellMs: 5200 },
  { id: 'sort', anchor: 'payables', title: 'Agents sort and extract', caption: 'Payables matches invoice details before any money moves.', dwellMs: 5200 },
  { id: 'vendor', anchor: 'vendor_onboarding', title: 'Verify the vendor', caption: 'A bank change is held until vendor evidence is checked.', dwellMs: 5200 },
  { id: 'handoff', anchor: 'payables', title: 'Vendor Desk → Payables', caption: 'Vendor Desk hands verified evidence to Payables. This handoff is illustrated, not a live task.', dwellMs: 5200, handoff: ['vendor_onboarding', 'payables'] },
  { id: 'dana', anchor: 'dana', title: 'A human decides', caption: 'An escalation goes to Dana; only a human can approve, using a passkey.', dwellMs: 5200, preview: 'escalation' },
  { id: 'treasury', anchor: 'treasury', title: 'Treasury: DENY', caption: 'Treasury refuses entry · NOT_IN_BADGE. Illustration only; receipts appear below when this session has recorded them.', dwellMs: 5200, preview: 'denial' },
];
// The lobby interaction still approaches the kiosk; the story opens with a north-facing survey.
const STORY_ANCHORS = { ...OFFICE_ANCHORS, lobby: { ...OFFICE_ANCHORS.lobby, position: ROOM_SPAWNS.lobby.position } };
/** Resolve named walking anchors, including after a room layout changes. */
export function storyCameraPose(anchor: AnchorId, anchors: Readonly<Record<AnchorId, {
  readonly position: readonly [number, number]; readonly center: readonly [number, number];
}>> = STORY_ANCHORS): IntroPose {
  const { position, center } = anchors[anchor];
  const [x, z] = position;
  // Entry surveys the pods and north board bay; later stops face their destination.
  const yaw = anchor === 'lobby' ? 0 : Math.atan2(x - center[0], z - center[1]);
  return { position: [x, EYE_HEIGHT, z], quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
}
/** Follow the same clear pod aisles as handoffs instead of flying through desks and screens. */
export function interpolateStoryPose(from: IntroPose, to: IntroPose, progress: number): IntroPose {
  const pose = interpolateIntroPose(from, to, progress);
  if (progress <= 0 || progress >= 1) return pose;
  const route = workspaceRoute([from.position[0], from.position[2]], [to.position[0], to.position[2]]);
  const lengths = route.slice(1).map((point, i) => Math.hypot(point[0] - route[i]![0], point[1] - route[i]![1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length && length > 0) {
      const a = route[i]!, b = route[i + 1]!, t = remaining / length;
      return { ...pose, position: [a[0] + (b[0] - a[0]) * t, pose.position[1], a[1] + (b[1] - a[1]) * t] };
    }
    remaining -= length;
  }
  return pose;
}
export function storyChapters(visible: readonly AnchorId[]) { return STORY_CHAPTERS.filter(chapter => visible.includes(chapter.anchor)); }
export function storyTotalMs(chapters = STORY_CHAPTERS): number { return chapters.reduce((total, chapter) => total + chapter.dwellMs, 0); }
export function storyChapterAt(elapsedMs: number, chapters = STORY_CHAPTERS): number {
  let elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  for (let i = 0; i < chapters.length; i++) { elapsed -= chapters[i]!.dwellMs; if (elapsed < 0) return i; }
  return Math.max(0, chapters.length - 1);
}
export function storyProgress(elapsedMs: number, chapters = STORY_CHAPTERS, reduced = false): number {
  if (!chapters.length) return 0;
  if (reduced) return (storyChapterAt(elapsedMs, chapters) + 1) / chapters.length;
  return Math.min(1, Math.max(0, elapsedMs / storyTotalMs(chapters)));
}
