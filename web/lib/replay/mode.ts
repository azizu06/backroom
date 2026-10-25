/** Replay query presence is authoritative, even before the recorded snapshot hydrates. */
export function isReplayPage(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('replay');
}
