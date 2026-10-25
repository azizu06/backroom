import type { AnchorId } from './state';

export type StoryChapter = { readonly id: string; readonly anchor: AnchorId; readonly title: string; readonly caption: string; readonly dwellMs: number; readonly preview?: 'escalation' | 'denial' };
export const STORY_CHAPTERS: readonly StoryChapter[] = [
  { id: 'inbox', anchor: 'lobby', title: 'A messy inbox arrives', caption: 'Invoices and emails enter one queue for review.', dwellMs: 5200 },
  { id: 'sort', anchor: 'payables', title: 'Agents sort and extract', caption: 'Payables matches invoice details before any money moves.', dwellMs: 5200 },
  { id: 'vendor', anchor: 'vendor_onboarding', title: 'Verify the vendor', caption: 'A bank change is held until vendor evidence is checked.', dwellMs: 5200 },
  { id: 'collections', anchor: 'collections', title: 'A disclosed AI call', caption: 'The caller identifies as AI, checks consent and observes calling hours.', dwellMs: 5200 },
  { id: 'treasury', anchor: 'treasury', title: 'Policy denies access', caption: 'Treasury refuses entry · NOT_IN_BADGE.', dwellMs: 5200, preview: 'denial' },
  { id: 'dana', anchor: 'dana', title: 'A human decides', caption: 'An escalation goes to Dana; only a human can approve, using a passkey.', dwellMs: 5200, preview: 'escalation' },
  { id: 'audit', anchor: 'lobby', title: 'Every step leaves a receipt', caption: 'The audit wall records decisions; ask why to inspect the evidence.', dwellMs: 5200 },
];
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
