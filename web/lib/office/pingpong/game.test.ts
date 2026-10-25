import { describe, expect, it } from 'vitest';
import { advanceAI, COURT, newMatch, paddleX, stepMatch, stepMatchInPlace, type GameEvent, type Match } from './game';

const rally = (patch: Partial<Match> = {}): Match => ({ ...newMatch(), pause: 0, ...patch });

describe('ping pong physics', () => {
  it('integrates gravity without mutating the previous frame and ignores invalid time', () => {
    const before = rally();
    const saved = structuredClone(before);
    const after = stepMatch(before, 1 / 60, 0).state;
    expect(after.ball.z).toBeGreaterThan(before.ball.z);
    expect(after.ball.vy).toBeCloseTo(before.ball.vy - 7.5 / 60);
    expect(before).toEqual(saved);
    for (const dt of [0, -1, NaN, Infinity]) expect(stepMatch(before, dt, 0).state.ball).toEqual(before.ball);
  });
  it('bounces on the receiving half of the tabletop', () => {
    const match = rally({ ball: { x: 0, y: 0.04, z: 0.6, vx: 0, vy: -1, vz: 2.5 } });
    const next = stepMatch(match, 0.02, 0);
    expect(next.events).toEqual(['bounce']);
    expect(next.state.ball.y).toBeGreaterThan(COURT.radius);
    expect(next.state.ball.vy).toBeGreaterThan(0);
    expect(next.state.bounces).toBe(1);
  });
  it('returns from either paddle and uses the impact offset to aim the shot', () => {
    for (const side of ['player', 'ai'] as const) {
      const sign = side === 'player' ? 1 : -1;
      const match = rally({ lastHit: side === 'player' ? 'ai' : 'player', bounces: 1, reaction: 10,
        ball: { x: 0.15, y: 0.25, z: sign * (COURT.halfLength - 0.01), vx: 0, vy: -0.1, vz: sign * 2.5 } });
      const result = stepMatch(match, 0.02, 0);
      expect(result.events).toContain('hit');
      expect(result.state.lastHit).toBe(side);
      expect(result.state.ball.vz * sign).toBeLessThan(0);
      expect(result.state.ball.vx).toBeGreaterThan(0);
      expect(result.state.bounces).toBe(0);
    }
  });
  it('permits a complete serve, bounce and human return', () => {
    let state = rally();
    const events: string[] = [];
    for (let frame = 0; frame < 65; frame++) {
      const next = stepMatch(state, 1 / 60, state.ball.x);
      events.push(...next.events);
      state = next.state;
    }
    expect(events).toContain('bounce');
    expect(events).toContain('hit');
    expect(events).not.toContain('point');
  });
  it('matches immutable steps over a scripted rally while reusing ball, score and event storage', () => {
    const mutable = newMatch();
    const ball = mutable.ball;
    const score = mutable.score;
    const events: GameEvent[] = [];
    const seen = new Set<GameEvent>();
    let immutable = newMatch();
    for (let frame = 0; frame < 1800; frame++) {
      const player = frame < 150 ? immutable.ball.x : Math.sin(frame / 20) * COURT.halfWidth;
      const previous = structuredClone(immutable);
      const next = stepMatch(immutable, 1 / 60, player);
      stepMatchInPlace(mutable, 1 / 60, player, events);
      expect(immutable).toEqual(previous);
      expect(mutable).toEqual(next.state);
      expect(events).toEqual(next.events);
      expect(mutable.ball).toBe(ball);
      expect(mutable.score).toBe(score);
      for (const event of events) seen.add(event);
      immutable = next.state;
    }
    expect(seen).toEqual(new Set(['bounce', 'hit', 'point']));
    expect(mutable.winner).not.toBeNull();
  });
  it('clears the reused event buffer even when time is invalid or the match has ended', () => {
    for (const seconds of [0, -1, NaN, Infinity, 1 / 60]) {
      const match = rally(seconds > 0 && Number.isFinite(seconds) ? { winner: 'player' } : {});
      const events: GameEvent[] = ['point'];
      const expected = stepMatch(match, seconds, 0.2);
      stepMatchInPlace(match, seconds, 0.2, events);
      expect(match).toEqual(expected.state);
      expect(events).toEqual([]);
    }
  });
  it('awards a net fault to the receiver and lets a high ball clear it', () => {
    const low = rally({ ball: { x: 0, y: 0.1, z: -0.01, vx: 0, vy: 0, vz: 2.5 } });
    expect(stepMatch(low, 0.02, 0).state.score).toEqual({ player: 1, ai: 0 });
    const high = { ...low, ball: { ...low.ball, y: 0.4 } };
    expect(stepMatch(high, 0.02, 0).events).toEqual([]);
  });
  it('never bounces a ball that missed the side of the table', () => {
    const miss = rally({ ball: { x: 0.9, y: 0.04, z: 0.5, vx: 0, vy: -2, vz: 2.5 } });
    const next = stepMatch(miss, 0.1, 0);
    expect(next.events).not.toContain('bounce');
    expect(next.state.bounces).toBe(0);
  });
});

describe('ping pong scoring', () => {
  const missed = rally({ bounces: 1, ball: { x: 0.55, y: 0.2, z: 1.34, vx: 0, vy: -1, vz: 2.5 } });
  it('scores a missed return once and pauses before serving again', () => {
    const next = stepMatch(missed, 0.02, -0.4);
    expect(next.events).toEqual(['point']);
    expect(next.state.score).toEqual({ player: 0, ai: 1 });
    expect(next.state.pause).toBe(0.8);
    const paused = stepMatch(next.state, 0.1, 0).state;
    expect(paused.score).toEqual(next.state.score);
    expect(paused.ball).toEqual(next.state.ball);
  });
  it('scores out shots for the receiver and a second bounce for the hitter', () => {
    expect(stepMatch({ ...missed, bounces: 0 }, 0.02, -0.4).state.score).toEqual({ player: 1, ai: 0 });
    const double = { ...missed, ball: { x: 0, y: 0.04, z: 0.7, vx: 0, vy: -1, vz: 1 } };
    expect(stepMatch(double, 0.02, 0).state.score).toEqual({ player: 0, ai: 1 });
  });
  it('penalizes hitting your own half or volleying before a bounce', () => {
    const ownHalf = rally({ ball: { x: 0, y: 0.04, z: -0.7, vx: 0, vy: -1, vz: 1 } });
    expect(stepMatch(ownHalf, 0.02, 0).state.score.player).toBe(1);
    const volley = rally({ ball: { x: 0, y: 0.3, z: 1.09, vx: 0, vy: 0, vz: 2.5 } });
    expect(stepMatch(volley, 0.02, 0).state.score.ai).toBe(1);
  });
  it('ends at five and freezes further scoring and ball motion', () => {
    const final = stepMatch({ ...missed, score: { player: 3, ai: 4 } }, 0.02, -0.4).state;
    expect(final.winner).toBe('ai');
    expect(final.score).toEqual({ player: 3, ai: 5 });
    const next = stepMatch(final, 0.1, 0);
    expect(next.events).toEqual([]);
    expect(next.state.ball).toEqual(final.ball);
    expect(next.state.score).toEqual(final.score);
    expect(newMatch().winner).toBeNull();
  });
});

describe('beatable AI and paddle limits', () => {
  it('moves toward a target at a capped speed and cannot reach a wide shot instantly', () => {
    expect(advanceAI(0, 0.4, 0.1)).toBeCloseTo(0.065);
    expect(advanceAI(0.4, -0.4, 0.1)).toBeCloseTo(0.335);
    expect(advanceAI(0, 0.01, 0.1)).toBeCloseTo(0.01);
    expect(paddleX(10)).toBeCloseTo(0.43);
    expect(paddleX(-10)).toBeCloseTo(-0.43);
  });
  it('waits for its next observation before following the ball', () => {
    const state = rally({ reaction: 0.2, ball: { x: 0.4, y: 0.4, z: 0.2, vx: 0, vy: 1, vz: -2.5 } });
    const waiting = stepMatch(state, 0.1, 0).state;
    expect(waiting.ai).toBe(0);
    const observed = stepMatch({ ...waiting, reaction: 0.01 }, 0.05, 0).state;
    expect(observed.aiTarget).toBe(0.4);
    expect(observed.ai).toBeGreaterThan(0);
    expect(observed.ai).toBeLessThan(0.04);
  });
  it('loses a wide return when its delayed reaction arrives too late', () => {
    const shot = rally({ lastHit: 'player', bounces: 1, reaction: 0.22,
      ball: { x: 0.5, y: 0.25, z: -0.95, vx: 0, vy: 0, vz: -2.6 } });
    let state = shot;
    for (let i = 0; i < 12; i++) state = stepMatch(state, 1 / 60, 0).state;
    expect(state.score.player).toBe(1);
  });
});
