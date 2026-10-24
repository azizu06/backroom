/** Pure visual choreography for the public agent runtime projection (docs/agents.md / PR #152).
 * Sequence orders independent handoffs; status updates keep an existing courier's journey.
 * Offered carries the folder; accepted passes it to the worker; rejected carries it home.
 * Corrections are separate reverse rows. No business writes or decisions happen here.
 */
import {
  HANDOFF_AGENTS, HUMAN, compareHandoffs, handoffLine, handoffRoute, handoffSpot, isHandoffAgent, needsHandoffHuman, routeLength,
  upsertHandoffs, type Handoff, type HandoffAgentId,
} from './handoffs';
import type { FloorPosition } from './state';

/** Matches WalkMotion (2.4 floor units per second). */
export const HANDOFF_WALK_SPEED = 2.4 / 1000;
export const PASS_MS = 1200;
export const BUBBLE_TAIL_MS = 1600;

export interface Leg { readonly handoffId: string; readonly phase: 'out' | 'home' | 'return' | 'reset'; readonly actor: HandoffAgentId; readonly start: number; readonly end: number; readonly route: readonly FloorPosition[]; readonly returning: boolean }
export interface Hold { readonly handoffId: string; readonly actor: HandoffAgentId; readonly start: number; readonly end: number; readonly at: FloorPosition; readonly facing: FloorPosition }
/** Folder segment: carried by an actor or passed between two actors. */
export type FolderSegment =
  | { readonly kind: 'carry'; readonly actor: HandoffAgentId; readonly start: number; readonly end: number }
  | { readonly kind: 'pass'; readonly from: HandoffAgentId; readonly to: HandoffAgentId; readonly start: number; readonly end: number };
export interface Folder { readonly handoffId: string; readonly failed: boolean; readonly correction: boolean; readonly failAt: number; readonly segments: readonly FolderSegment[] }
export type BubbleTone = 'info' | 'fail' | 'passkey' | 'correction';
export interface Bubble { readonly actor: HandoffAgentId; readonly start: number; readonly end: number; readonly text: string; readonly tone: BubbleTone }
export interface Trip {
  readonly handoff: Handoff;
  readonly courier: HandoffAgentId;
  readonly receiver: HandoffAgentId;
  readonly start: number;
  /** Courier reaches the other desk. */
  readonly arrive: number;
  readonly end: number;
  /** Rejection after delivery: B returns the folder, while A finishes walking home. */
  readonly returnAt?: number;
}
export interface HandoffPlan {
  readonly legs: readonly Leg[];
  readonly holds: readonly Hold[];
  readonly folders: readonly Folder[];
  readonly bubbles: readonly Bubble[];
  readonly trips: readonly Trip[];
  /** [start, end) windows when Dana is at her desk; end Infinity while a passkey is awaited. */
  readonly human: readonly (readonly [number, number])[];
  /** Rows that were not animated (unknown agents or self-handoffs). */
  readonly skipped: readonly string[];
}
export const EMPTY_PLAN: HandoffPlan = { legs: [], holds: [], folders: [], bubbles: [], trips: [], human: [], skipped: [] };

function reversed(route: readonly FloorPosition[]): FloorPosition[] { return [...route].reverse(); }
function walkMs(route: readonly FloorPosition[], speed: number) { return routeLength(route) / speed; }

/** Prefix of a walk, including its exact current position, for an immediate rejection return. */
function routeUntil(leg: Leg, now: number): FloorPosition[] {
  const distance = routeLength(leg.route) * Math.min(1, Math.max(0, (now - leg.start) / (leg.end - leg.start)));
  const points: FloorPosition[] = [leg.route[0]!];
  let walked = 0;
  for (let i = 1; i < leg.route.length; i++) {
    const a = leg.route[i - 1]!, b = leg.route[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + length >= distance) { points.push(along(leg.route, distance).position); break; }
    points.push(b); walked += length;
  }
  return points;
}
export interface PlanOptions {
  readonly speed?: number;
  readonly previous?: HandoffPlan;
  readonly now?: number;
  readonly openEscalation?: boolean;
}
export function planHandoffs(rows: readonly Handoff[], { speed = 1, previous = EMPTY_PLAN, now = -Infinity, openEscalation = false }: PlanOptions = {}): HandoffPlan {
  const pace = HANDOFF_WALK_SPEED * speed, pass = PASS_MS / speed, tail = BUBBLE_TAIL_MS / speed;
  // Sequence age does not tell us whether a walk or an offered-folder hold has finished.
  const ordered = upsertHandoffs([], rows);
  const free = new Map<HandoffAgentId, number>();
  const legs: Leg[] = [], holds: Hold[] = [], folders: Folder[] = [], bubbles: Bubble[] = [], trips: Trip[] = [];
  const human: [number, number][] = openEscalation ? [[0, Infinity]] : [], skipped: string[] = [];
  const freeAt = (id: HandoffAgentId) => free.get(id) ?? -Infinity;

  for (const row of ordered) {
    const courier = row.fromRole, receiver = row.toRole;
    if (!isHandoffAgent(courier) || !isHandoffAgent(receiver) || courier === receiver) { skipped.push(row.handoffId); continue; }
    // Preserve a started trip only while it still fits the actors' sequence-ordered schedule.
    // An earlier in-place rejection can reserve either actor for a newly added return walk.
    const available = Math.max(freeAt(courier), freeAt(receiver));
    const prior = previous.trips.find(trip => trip.handoff.handoffId === row.handoffId && trip.start <= now && trip.start >= available);
    const priorOut = prior && previous.legs.find(leg => leg.handoffId === row.handoffId && leg.phase === 'out');
    const priorHome = prior && previous.legs.find(leg => leg.handoffId === row.handoffId && leg.phase === 'home');
    const priorFolder = prior && previous.folders.find(folder => folder.handoffId === row.handoffId);
    const rejected = row.status === 'rejected';
    const addReturnBubble = (trip: Trip, actor: HandoffAgentId, at: number) => {
      bubbles.push({ actor, start: at, end: trip.end + tail, text: handoffLine(row), tone: 'fail' });
      if (needsHandoffHuman(row)) human.push([row.createdAt, (row.completedAt ?? trip.end) + tail]);
    };
    // Keep an interrupted journey immutable on subsequent updates to this same primary key.
    if (rejected && prior?.handoff.status === 'rejected' && priorFolder) {
      const trip = { ...prior, handoff: row };
      const savedLegs = previous.legs.filter(leg => leg.handoffId === row.handoffId);
      legs.push(...savedLegs); holds.push(...previous.holds.filter(hold => hold.handoffId === row.handoffId));
      folders.push(priorFolder); trips.push(trip);
      addReturnBubble(trip, trip.returnAt !== undefined ? receiver : courier, trip.returnAt ?? trip.start);
      free.set(courier, Math.max(...savedLegs.filter(leg => leg.actor === courier).map(leg => leg.end)));
      free.set(receiver, trip.returnAt !== undefined ? trip.end : priorFolder.failAt);
      continue;
    }
    // Once B owns the folder, a stopped case sends B back to A. A's existing walk stays continuous.
    const delivery = priorFolder?.segments.find(segment => segment.kind === 'pass');
    if (rejected && prior?.handoff.status === 'accepted' && priorFolder && delivery && now >= delivery.start) {
      const returnAt = Math.max(now, delivery.end);
      const current = actorAt(previous, receiver, returnAt).position;
      const route = [current, ...handoffRoute(receiver, courier).slice(1)];
      const arrive = returnAt + walkMs(route, pace), homeStart = arrive + pass;
      const home = reversed(route), end = homeStart + walkMs(home, pace);
      legs.push(...previous.legs.filter(leg => leg.handoffId === row.handoffId),
        { handoffId: row.handoffId, phase: 'return', actor: receiver, start: returnAt, end: arrive, route, returning: true },
        { handoffId: row.handoffId, phase: 'reset', actor: receiver, start: homeStart, end, route: home, returning: false });
      holds.push(...previous.holds.filter(hold => hold.handoffId === row.handoffId),
        { handoffId: row.handoffId, actor: receiver, start: arrive, end: homeStart, at: route.at(-1)!, facing: HANDOFF_AGENTS[courier].station });
      const segments: FolderSegment[] = priorFolder.segments.filter(segment => segment.start < returnAt)
        .map(segment => ({ ...segment, end: Math.min(segment.end, returnAt) }));
      segments.push({ kind: 'carry', actor: receiver, start: returnAt, end: arrive },
        { kind: 'pass', from: receiver, to: courier, start: arrive, end: homeStart });
      const trip = { ...prior, handoff: row, end, returnAt };
      folders.push({ ...priorFolder, failed: true, failAt: now, segments }); trips.push(trip);
      addReturnBubble(trip, receiver, now);
      free.set(courier, Math.max(prior.end, homeStart)); free.set(receiver, end);
      continue;
    }
    const start = prior?.start ?? Math.max(row.createdAt ?? 0, freeAt(courier), freeAt(receiver));
    let out = priorOut?.route ?? handoffRoute(courier, receiver);
    let arrive = prior?.arrive ?? start + walkMs(out, pace);
    const newlyRejected = rejected && !!prior && prior.handoff.status !== 'rejected';
    if (newlyRejected && priorOut && now < priorOut.end) { out = routeUntil(priorOut, now); arrive = now; }
    const back = reversed(out), spot = out.at(-1)!;
    const receiverHome = HANDOFF_AGENTS[receiver].station;
    let passStart = Math.max(arrive, row.acceptedAt ?? arrive);
    // Once a pass or homeward walk has begun, a late timestamp cannot move it back in time.
    if (priorHome && prior!.handoff.status !== 'offered' && now >= prior!.arrive) passStart = priorHome.start - pass;
    let homeStart = rejected ? (newlyRejected ? Math.max(arrive, now) : priorHome?.start ?? arrive)
      : row.status === 'offered' ? Infinity : passStart + pass;
    const keepHome = priorHome && priorHome.start <= now && (!newlyRejected || now < priorHome.end);
    if (keepHome) homeStart = priorHome.start;
    const homeRoute = keepHome ? priorHome.route : newlyRejected && now >= prior!.end ? [HANDOFF_AGENTS[courier].station] : back;
    const end = keepHome ? priorHome.end : homeStart + walkMs(homeRoute, pace);
    legs.push({ handoffId: row.handoffId, phase: 'out', actor: courier, start, end: arrive, route: out, returning: row.correction });
    if (homeStart > arrive) holds.push({ handoffId: row.handoffId, actor: courier, start: arrive, end: homeStart, at: spot, facing: receiverHome });
    if (Number.isFinite(homeStart)) legs.push({ handoffId: row.handoffId, phase: 'home', actor: courier, start: homeStart, end, route: homeRoute, returning: rejected });
    const segments: FolderSegment[] = [];
    if (rejected) segments.push({ kind: 'carry', actor: courier, start, end });
    else {
      segments.push({ kind: 'carry', actor: courier, start, end: row.status === 'offered' ? Infinity : passStart });
      if (row.status !== 'offered') {
        segments.push({ kind: 'pass', from: courier, to: receiver, start: passStart, end: homeStart });
        const nextWork = ordered.find(next => next.sequence > row.sequence && next.fromRole === receiver && next.caseDisplayId === row.caseDisplayId)?.createdAt ?? Infinity;
        const workEnd = row.status === 'completed' ? Math.max(homeStart, row.completedAt ?? homeStart) : nextWork;
        if (workEnd > homeStart) segments.push({ kind: 'carry', actor: receiver, start: homeStart, end: workEnd });
      }
    }
    const tone: BubbleTone = rejected ? 'fail' : row.correction ? 'correction' : 'info';
    bubbles.push({ actor: courier, start, end: rejected ? end + tail : homeStart + tail,
      text: handoffLine(row), tone });
    if (!rejected && row.status !== 'offered') bubbles.push({ actor: receiver,
      start: homeStart, end: Math.max(homeStart, row.completedAt ?? homeStart) + tail,
      text: handoffLine(row), tone });
    if (needsHandoffHuman(row)) {
      const until = row.completedAt ?? (rejected ? end : Infinity);
      human.push([row.createdAt ?? start, until + tail]);
      bubbles.push({ actor: HUMAN, start: row.createdAt ?? start, end: until + tail,
        text: 'Human passkey approval · ' + row.caseDisplayId, tone: 'passkey' });
    }
    folders.push({ handoffId: row.handoffId, failed: rejected, correction: row.correction, failAt: rejected ? homeStart : Infinity, segments });
    trips.push({ handoff: row, courier, receiver, start, arrive, end });
    free.set(courier, end); free.set(receiver, homeStart);
  }
  return { legs, holds, folders, bubbles, trips, human, skipped };
}

export interface ActorFrame {
  readonly id: HandoffAgentId;
  readonly position: [number, number];
  /** Same convention as WalkMotion: atan2(dx, dz). */
  readonly heading: number;
  readonly moving: boolean;
  /** Distance along the current leg, for the leg swing. */
  readonly stride: number;
  readonly returning: boolean;
}
export interface FolderFrame {
  readonly handoffId: string; readonly position: [number, number, number]; readonly failed: boolean; readonly correction: boolean;
  /** Who holds it in front of them; absent while it is mid-pass. */
  readonly carrier?: HandoffAgentId;
}
export interface HandoffFrame {
  readonly actors: readonly ActorFrame[];
  readonly folders: readonly FolderFrame[];
  readonly bubbles: readonly Bubble[];
  readonly human: boolean;
  /** Something is moving: an on-demand renderer should keep requesting frames. */
  readonly animating: boolean;
}

function homeHeading(id: HandoffAgentId) {
  const station = HANDOFF_AGENTS[id].station, spot = handoffSpot(id);
  return Math.atan2(spot[0] - station[0], spot[1] - station[1]);
}
function along(route: readonly FloorPosition[], distance: number): { position: [number, number]; heading: number } {
  let left = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (left <= length || i === route.length - 1) {
      const t = Math.min(1, left / length);
      return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading };
    }
    left -= length;
  }
  const last = route[route.length - 1]!;
  return { position: [last[0], last[1]], heading: 0 };
}

/** Floor position and heading of an actor at `now`; idle actors stand at their station. */
export function actorAt(plan: HandoffPlan, id: HandoffAgentId, now: number, reduced = false): ActorFrame {
  const home = HANDOFF_AGENTS[id].station;
  const idle: ActorFrame = { id, position: [home[0], home[1]], heading: homeHeading(id), moving: false, stride: 0, returning: false };
  if (reduced) return idle;
  const leg = plan.legs.find(entry => entry.actor === id && now >= entry.start && now < entry.end);
  if (leg) {
    const total = routeLength(leg.route);
    const distance = total * (now - leg.start) / Math.max(1e-9, leg.end - leg.start);
    const { position, heading } = along(leg.route, distance);
    return { id, position, heading, moving: true, stride: distance, returning: leg.returning };
  }
  const hold = plan.holds.find(entry => entry.actor === id && now >= entry.start && now < entry.end);
  if (hold) {
    return { id, position: [hold.at[0], hold.at[1]], heading: Math.atan2(hold.facing[0] - hold.at[0], hold.facing[1] - hold.at[1]), moving: false, stride: 0, returning: false };
  }
  return idle;
}

const HAND_Y = 0.95;
function handOf(actor: ActorFrame): [number, number, number] {
  // Folder sits just in front of the chest, along the heading.
  return [actor.position[0] + Math.sin(actor.heading) * 0.32, HAND_Y, actor.position[1] + Math.cos(actor.heading) * 0.32];
}
export function humanVisible(plan: HandoffPlan, now: number): boolean {
  return plan.human.some(([start, end]) => now >= start && now < end);
}

export function sampleHandoffs(plan: HandoffPlan, now: number, { reduced = false }: { reduced?: boolean } = {}): HandoffFrame {
  const ids = new Set<HandoffAgentId>(Object.keys(HANDOFF_AGENTS) as HandoffAgentId[]);
  const actors = new Map<HandoffAgentId, ActorFrame>();
  for (const id of ids) actors.set(id, actorAt(plan, id, now, reduced));
  const human = humanVisible(plan, now);
  const folders: FolderFrame[] = [];
  if (!reduced) for (const folder of plan.folders) {
    const segment = folder.segments.find(entry => now >= entry.start && now < entry.end);
    if (!segment) continue;
    const failed = folder.failed && now >= folder.failAt;
    if (segment.kind === 'carry') {
      if (segment.actor === HUMAN && !human) continue;
      folders.push({ handoffId: folder.handoffId, position: handOf(actors.get(segment.actor)!), failed, correction: folder.correction, carrier: segment.actor });
    } else {
      const t = Math.min(1, Math.max(0, (now - segment.start) / Math.max(1e-9, segment.end - segment.start)));
      const ease = t * t * (3 - 2 * t);
      const a = handOf(actors.get(segment.from)!), b = handOf(actors.get(segment.to)!);
      // A small arc so the pass reads as a hand-over rather than a slide.
      folders.push({ handoffId: folder.handoffId, failed, correction: folder.correction, position: [a[0] + (b[0] - a[0]) * ease, a[1] + (b[1] - a[1]) * ease + Math.sin(Math.PI * ease) * 0.18, a[2] + (b[2] - a[2]) * ease] });
    }
  }
  const latest = new Map<HandoffAgentId, Bubble>();
  for (const bubble of plan.bubbles) {
    if (now < bubble.start || now >= bubble.end) continue;
    if (bubble.actor === HUMAN && !human) continue;
    const current = latest.get(bubble.actor);
    if (!current || bubble.start >= current.start) latest.set(bubble.actor, bubble);
  }
  const animating = !reduced && (plan.legs.some(leg => now >= leg.start && now < leg.end)
    || plan.folders.some(folder => folder.segments.some(segment => segment.kind === 'pass' && now >= segment.start && now < segment.end)));
  return { actors: [...actors.values()], folders, bubbles: [...latest.values()], human, animating };
}

/** Next time after `now` the drawn frame changes without motion (a bubble, Dana, a leg starting). */
export function nextChange(plan: HandoffPlan, now: number): number | null {
  let next = Infinity;
  const consider = (time: number) => { if (time > now && time < next) next = time; };
  for (const leg of plan.legs) consider(leg.start);
  for (const hold of plan.holds) { consider(hold.start); consider(hold.end); }
  for (const bubble of plan.bubbles) { consider(bubble.start); consider(bubble.end); }
  for (const folder of plan.folders) for (const segment of folder.segments) { consider(segment.start); consider(segment.end); }
  for (const [start, end] of plan.human) { consider(start); consider(end); }
  return Number.isFinite(next) ? next : null;
}

/** The handoff an actor is carrying or handling at `now`, else its most recent one. */
export function handoffFor(plan: HandoffPlan, rows: readonly Handoff[], actor: string, now: number): Handoff | undefined {
  const live = plan.trips.find(trip => (trip.courier === actor || trip.receiver === actor) && now >= trip.start && now < trip.end);
  if (live) return rows.find(row => row.handoffId === live.handoff.handoffId) ?? live.handoff;
  return rows.filter(row => row.fromRole === actor || row.toRole === actor || (actor === HUMAN && needsHandoffHuman(row))).sort((a, b) => compareHandoffs(b, a))[0];
}

/**
 * Shared, mutable holder (like MotionRegistry) so Office (initial bundle), the lazy scene and the
 * Play rig read one plan. Re-plans only when the row array changes.
 */
export class HandoffStage {
  private rows: readonly Handoff[] = [];
  plan: HandoffPlan = EMPTY_PLAN;
  private openEscalation = false;
  constructor(readonly speed = 1) {}
  update(rows: readonly Handoff[], now = Date.now(), openEscalation = false): boolean {
    if (rows === this.rows && openEscalation === this.openEscalation) return false;
    this.openEscalation = openEscalation;
    this.rows = rows;
    this.plan = planHandoffs(rows, { speed: this.speed, previous: this.plan, now, openEscalation });
    return true;
  }
  get current(): readonly Handoff[] { return this.rows; }
  sample(now: number, reduced = false): HandoffFrame { return sampleHandoffs(this.plan, now, { reduced }); }
  handoffFor(actor: string, now: number) { return handoffFor(this.plan, this.rows, actor, now); }
}
