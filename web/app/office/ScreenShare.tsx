'use client';

import { useEffect, useRef } from 'react';
import { screenStore, seatAt, type ScreenState } from '../../lib/office/screens';
import './screen-share.css';

/** The big view of someone's shared screen, opened from their desk in Play; Esc or Close returns. */
function WatchOverlay({ state, desk, close }: { state: ScreenState; desk: number; close: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const seat = seatAt(state, desk), frame = state.frames[desk];
  useEffect(() => {
    const image = frame ? screenStore.image(desk) : undefined, target = canvas.current;
    if (!image || !target) return;
    target.width = image.width; target.height = image.height;
    target.getContext('2d')?.drawImage(image, 0, 0);
  }, [desk, frame]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return <div className='screen-watch' role='dialog' aria-modal='true' aria-label={`${seat?.name ?? 'Shared'} screen`}>
    <header><strong>{seat?.name ?? 'Someone'}’s screen</strong><span>Live · updates twice a second</span>
      <button type='button' onClick={close} autoFocus>Close (Esc)</button></header>
    {frame ? <canvas ref={canvas} /> : <p role='status'>Waiting for their screen…</p>}
  </div>;
}

/** Your own share banner, the watch overlay, and any share error. View only: nothing here acts on the office. */
export function ScreenShare({ share }: { share: { state: ScreenState; sharing: number | null; overlay: number | null; closeOverlay(): void; stopSharing(): void; error: string | null; clearError(): void } }) {
  return <>
    {share.sharing !== null && <div className='screen-share-banner' role='status'>
      <span>You’re sharing your screen at this desk. People who walk over can see it.</span>
      <button type='button' onClick={share.stopSharing}>Stop sharing</button>
    </div>}
    {share.error && <div className='screen-share-banner' role='alert' data-error>
      <span>{share.error}</span><button type='button' onClick={share.clearError}>OK</button>
    </div>}
    {share.overlay !== null && <WatchOverlay state={share.state} desk={share.overlay} close={share.closeOverlay} />}
  </>;
}
