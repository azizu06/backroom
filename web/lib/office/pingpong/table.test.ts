import { afterEach, describe, expect, it, vi } from 'vitest';
import { insideAny, interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS } from '../play';
import { PINGPONG_COLLIDER as table } from './table';
import { pingPongSession } from './session';
import { pingPongTarget } from '../targets/pingpong';

afterEach(() => pingPongSession.stop());
describe('break room ping pong integration', () => {
  it('is detached from office collisions and Play prompts', () => {
    const colliders = officeColliders([]);
    expect(colliders).not.toContainEqual(table);
    expect(interactCandidates([], []).some(candidate => candidate.target.kind as string === 'pingpong')).toBe(false);
  });
  it('starts and stops a local session with subscription cleanup', () => {
    const listener = vi.fn();
    const unsubscribe = pingPongSession.subscribe(listener);
    pingPongTarget.activate?.({ kind: 'pingpong' });
    expect(pingPongSession.getSnapshot()).toBe(true);
    pingPongSession.start();
    expect(listener).toHaveBeenCalledTimes(1);
    pingPongSession.stop();
    expect(pingPongSession.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    pingPongSession.start();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
