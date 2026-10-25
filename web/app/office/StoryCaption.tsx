import type { OfficeSnapshot } from '../../lib/office/state';
import type { StoryChapter } from '../../lib/office/story';
import { recordedStoryDecision } from '../../lib/office/story-evidence';

export function StoryCaption({ chapter, index, total, snapshot }: {
  chapter: StoryChapter; index: number; total: number; snapshot: OfficeSnapshot;
}) {
  const evidence = recordedStoryDecision(chapter, snapshot);
  return <>
    <header className='story-disclaimer'>Scripted walkthrough · illustration, not recorded decisions{snapshot.connection === 'live' && ' · live state below is real'}</header>
    <p className='story-kicker'>Chapter {index + 1} of {total} · {chapter.anchor === 'vendor_onboarding' ? 'Vendor desk' : chapter.anchor === 'dana' ? 'Dana’s desk' : chapter.anchor[0]!.toUpperCase() + chapter.anchor.slice(1)}</p>
    <h2>{chapter.title}</h2><p>{chapter.caption}</p>
    <p className='story-evidence'>{evidence.label}{evidence.href && <> · <a href={evidence.href}>View receipt</a></>}</p>
    <span className='visually-hidden' aria-live='polite' aria-atomic='true'>Scripted walkthrough: Chapter {index + 1} of {total}: {chapter.title}. {chapter.caption} {evidence.label}</span>
  </>;
}
