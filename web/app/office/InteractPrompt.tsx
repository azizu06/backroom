'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from './props/useReducedMotion';

/** Keep outgoing text just long enough to fade; reduced motion clears it in the same render. */
export function InteractPrompt({ prompt }: { prompt: string }) {
  const reduced = useReducedMotion();
  const [last, setLast] = useState(prompt);
  useEffect(() => {
    if (prompt) { setLast(prompt); return; }
    if (reduced) { setLast(''); return; }
    const timeout = window.setTimeout(() => setLast(''), 140);
    return () => window.clearTimeout(timeout);
  }, [prompt, reduced]);
  const displayed = prompt || (reduced ? '' : last);
  return <p className='play-prompt' data-visible={!!prompt} aria-live='polite' aria-hidden={!prompt}>
    {displayed && <><kbd>E</kbd>{' · '}{displayed.slice(4)}</>}
  </p>;
}
