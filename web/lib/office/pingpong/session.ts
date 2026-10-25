import { requestSceneFrame } from '../frame';

// Local cosmetic camera ownership only. Match physics lives in the scene, never in finance state.
let active = false;
const listeners = new Set<() => void>();
function setActive(value: boolean) {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
  requestSceneFrame();
}
export const pingPongSession = {
  getSnapshot: () => active,
  getServerSnapshot: () => false,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  start: () => setActive(true),
  stop: () => setActive(false),
};
