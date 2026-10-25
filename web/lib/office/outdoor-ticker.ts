import { OUTDOOR_FPS } from './outdoor-motion';

type Subscription = { update: (elapsed: number) => boolean; invalidate: () => void };
const subscribers = new Set<Subscription>();
const invalidations = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let last = 0;

function tick() {
  const now = performance.now(), elapsed = (now - last) / 1000;
  last = now;
  for (const subscriber of subscribers) {
    if (subscriber.update(elapsed)) invalidations.add(subscriber.invalidate);
  }
  for (const invalidate of invalidations) invalidate();
  invalidations.clear();
}

function syncVisibility() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  last = performance.now();
  if (!document.hidden) timer = setInterval(tick, 1000 / OUTDOOR_FPS);
}

/** One demand-render clock for all outdoor batches, paused while the tab is hidden. */
export function subscribeOutdoorTicker(update: Subscription['update'], invalidate: () => void): () => void {
  const subscription = { update, invalidate };
  subscribers.add(subscription);
  if (subscribers.size === 1) {
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
  }
  return () => {
    subscribers.delete(subscription);
    if (subscribers.size === 0) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      document.removeEventListener('visibilitychange', syncVisibility);
    }
  };
}
