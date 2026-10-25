/** True for `?art=baked`. Pure so it is testable without the scene. */
export function bakedArtRequested(search: string): boolean {
  return new URLSearchParams(search).get('art') === 'baked';
}
