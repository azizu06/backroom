import { describe, expect, it } from 'vitest';
import { createReplayRecorder, parseReplay } from '../../../orchestrator/src/replay/record';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createReplayPlayer } from './player';
import { OFFICE_ANCHORS } from '../office/state';
import { CORRIDOR_Z } from '../office/layout';

/** WalkMotion pace (m/s): visual interpolation only. */
const WALK_SPEED = 2.4;

describe('read-only OfficeState replay', () => {
  it('keeps real timing at each speed, pauses, rewinds state and audit together', async () => {
    let at = 0;
    const recorder = createReplayRecorder({ name: 'timing', now: () => at });
    const store = recorder.attach(new MemoryStateStore(), 'call');
    await store.registerAgent('alex', 'collections', 1000);
    await store.enqueueTask({ id: 'invoice', seatId: 'collections', refs: [], steps: [] });
    const lease = (await store.claimTask('alex', 1000, 12000))!;
    at = 1000;
    await store.setAgentTarget(lease, 'dana_desk', 1000);
    await store.appendAudit({ ts: 1000, actor: 'code', seat: 'collections', action: 'plan', decision: 'ESCALATE',
      policyVersion: 1, ruleIds: ['MAX_INSTALLMENTS'], refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
    at = 3000;
    await store.setAgentTarget(lease, 'collections_desk', 1000);
    const player = createReplayPlayer(parseReplay(recorder.toJsonl()));
    expect(player.source.getSnapshot().connection).toBe('replay');
    const initial = player.source.getSnapshot();
    expect(player.source.getSnapshot()).toBe(initial);
    player.play(); player.advance(500);
    expect(player.source.getSnapshot().agents[0]?.targetAnchor).toBe('collections');
    player.setSpeed(2); player.advance(250);
    expect(player.source.getSnapshot().agents[0]?.targetAnchor).toBe('dana');
    expect(player.getSnapshot().entries.map(entry => entry.action)).toContain('plan');
    player.pause(); player.advance(1000);
    expect(player.getSnapshot().positionMs).toBe(1000);
    player.play(); player.advance(250); player.pause();
    // 0.5 s of walking (1000 to 1500 ms) from the Collections spot along the first leg toward the corridor.
    const [, startZ] = OFFICE_ANCHORS.collections.position;
    const walked = startZ + Math.sign(CORRIDOR_Z - startZ) * WALK_SPEED * 0.5;
    expect(Math.abs(walked - startZ)).toBeLessThan(Math.abs(CORRIDOR_Z - startZ));
    expect(player.source.getSnapshot().agents[0]?.pos[1]).toBeCloseTo(walked);
    const frozen = player.source.getSnapshot().agents[0]?.pos;
    player.advance(500);
    expect(player.source.getSnapshot().agents[0]?.pos).toEqual(frozen);
    player.seek(0);
    expect(player.getSnapshot().entries.map(entry => entry.action)).not.toContain('plan');
    expect(player.source.getSnapshot().agents[0]?.pos).toEqual([...OFFICE_ANCHORS.collections.position]);
    expect(player.source.getSnapshot().agents[0]?.targetAnchor).toBe('collections');
    player.seek(3000); player.play(); player.advance(1000);
    expect(player.getSnapshot().playing).toBe(false);
    expect(player.getSnapshot().positionMs).toBe(3000);
  });
});
