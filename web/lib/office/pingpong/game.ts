/** Small deterministic arcade match. Coordinates are table-local; +z is the human end, y is height above the top. */
export const COURT = { halfWidth: 0.65, halfLength: 1.1, height: 0.78, net: 0.15, radius: 0.035, paddle: 0.22, winningScore: 5 } as const;
export type Side = 'player' | 'ai';
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Match {
  ball: Ball; player: number; ai: number; aiTarget: number; reaction: number;
  score: Record<Side, number>; lastHit: Side; bounces: number; pause: number; winner: Side | null;
}
export type GameEvent = 'hit' | 'bounce' | 'point';
const other = (side: Side): Side => side === 'player' ? 'ai' : 'player';
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const paddleX = (x: number) => clamp(x, -COURT.halfWidth + COURT.paddle, COURT.halfWidth - COURT.paddle);

function serve(side: Side, ball: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }): Ball {
  ball.x = 0;
  ball.y = 0.24;
  ball.z = side === 'player' ? COURT.halfLength : -COURT.halfLength;
  ball.vx = 0.18;
  ball.vy = 2.1;
  ball.vz = side === 'player' ? -2.5 : 2.5;
  return ball;
}
export function newMatch(): Match {
  return { ball: serve('ai'), player: 0, ai: 0, aiTarget: 0, reaction: 0.22, score: { player: 0, ai: 0 }, lastHit: 'ai', bounces: 0, pause: 0.8, winner: null };
}

/** Delayed observations and capped speed let a wide angled shot beat the AI. */
export function advanceAI(x: number, target: number, dt: number): number {
  return paddleX(x + clamp(target - x, -0.65 * dt, 0.65 * dt));
}

/** Immutable convenience API for callers that retain previous frames. */
export function stepMatch(previous: Match, seconds: number, player: number): { state: Match; events: GameEvent[] } {
  const state: Match = { ...previous, ball: { ...previous.ball }, score: { ...previous.score } };
  const events: GameEvent[] = [];
  stepMatchInPlace(state, seconds, player, events);
  return { state, events };
}

function point(state: Match, side: Side, events: GameEvent[]) {
  state.score[side]++;
  state.winner = state.score[side] >= COURT.winningScore ? side : null;
  state.lastHit = (state.score.player + state.score.ai) % 2 ? 'player' : 'ai';
  serve(state.lastHit, state.ball);
  state.bounces = 0;
  state.pause = 0.8;
  events.push('point');
}

/** Allocation-free frame step. Clears and fills the caller's event buffer, retaining ball and score identities.
 * Substeps prevent tunnelling through the tabletop, net or paddles at normal display rates. */
export function stepMatchInPlace(state: Match, seconds: number, player: number, events: GameEvent[]): void {
  events.length = 0;
  state.player = paddleX(player);
  if (state.winner || !Number.isFinite(seconds) || seconds <= 0) return;
  let remaining = Math.min(seconds, 0.1);
  while (remaining > 1e-8) {
    const dt = Math.min(remaining, 1 / 240);
    remaining -= dt;
    if (state.pause > 0) { state.pause = Math.max(0, state.pause - dt); continue; }
    state.reaction -= dt;
    if (state.reaction <= 0) {
      state.aiTarget = state.ball.vz < 0 ? state.ball.x : 0;
      state.reaction = 0.22;
    }
    state.ai = advanceAI(state.ai, state.aiTarget, dt);
    const b = state.ball;
    const oldZ = b.z;
    const oldY = b.y;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.y += b.vy * dt - 3.75 * dt * dt;
    b.vy -= 7.5 * dt;
    // A low crossing hits the net; the hitter loses the rally.
    if (oldZ * b.z <= 0 && oldZ !== b.z && b.y - COURT.radius <= COURT.net && Math.abs(b.x) <= COURT.halfWidth) {
      point(state, other(state.lastHit), events); break;
    }
    const onTable = Math.abs(b.x) <= COURT.halfWidth && Math.abs(b.z) <= COURT.halfLength;
    if (onTable && oldY >= COURT.radius && b.y <= COURT.radius && b.vy < 0) {
      const landing: Side = b.z > 0 ? 'player' : 'ai';
      if (landing === state.lastHit) { point(state, other(state.lastHit), events); break; }
      if (state.bounces > 0) { point(state, state.lastHit, events); break; }
      state.bounces++;
      b.y = COURT.radius + (COURT.radius - b.y);
      b.vy = Math.abs(b.vy) * 0.88;
      events.push('bounce');
    }
    const side: Side = b.vz > 0 ? 'player' : 'ai';
    const end = side === 'player' ? COURT.halfLength : -COURT.halfLength;
    const crossing = side === 'player' ? oldZ < end && b.z >= end : oldZ > end && b.z <= end;
    const paddle = side === 'player' ? state.player : state.ai;
    if (crossing && Math.abs(b.x - paddle) <= COURT.paddle + COURT.radius && b.y >= COURT.radius && b.y <= 0.65) {
      if (state.bounces !== 1) { point(state, other(side), events); break; }
      const angle = clamp((b.x - paddle) / COURT.paddle, -1, 1);
      b.vx = angle * 1.25;
      b.vz = side === 'player' ? -2.6 : 2.6;
      b.vy = 2.1;
      b.z = end;
      state.lastHit = side;
      state.bounces = 0;
      events.push('hit');
    }
    if (Math.abs(b.z) > COURT.halfLength + 0.25 || b.y < -0.25) {
      point(state, state.bounces ? state.lastHit : other(state.lastHit), events); break;
    }
  }
}
