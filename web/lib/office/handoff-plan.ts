/**
 * Pure handoff choreography. `planHandoffs` turns handoff rows into a timeline of walks, holds,
 * folder passes and speech bubbles per agent; `sampleHandoffs` reads that timeline at a clock time.
 * Visual only: nothing here writes state. The scene samples it per frame; Play reads positions from it.
 *
 * Rules:
 * - Rows play in (at, id) order. A handoff starts once its row exists and both agents are free, so one
 *   agent's handoffs queue while handoffs between other agents overlap.
 * - The courier is `from` (or `to` when the row comes from Dana): it walks the aisle to the other desk,
 *   passes the folder, then walks home.
 * - `failed`: the receiver checks the folder, then walks it back to the sender (red folder, return
 *   bubble). When the receiver is Dana the courier carries it back instead.
 * - Dana (`human`) only appears at the passkey step: from the courier's arrival until the row is
 *   resolved (`updatedAt` on a non-passkey status), or indefinitely while it awaits her passkey.
 */
import {
  HANDOFF_AGENTS, HUMAN, handoffAgentName, handoffRoute, handoffSpot, isHandoffAgent, routeLength,
  type Handoff, type HandoffAgentId,
} from './handoffs';
import type { FloorPosition } from './state';

/** Matches WalkMotion (2.4 floor units per second). */
export const HANDOFF_WALK_SPEED = 2.4 / 1000;
export const PASS_MS = 1200;
export const CHECK_MS = 900;
export const BUBBLE_TAIL_MS = 1600;
export const HUMAN_HOLD_MS = 1500;
/** Only the most recent rows are choreographed; older ones stay in the text log. */
export const MAX_PLANNED = 40;

export interface Leg { readonly actor: HandoffAgentId; readonly start: number; readonly end: number; readonly route: readonly FloorPosition[]; readonly returning: boolean }
export interface Hold { readonly actor: HandoffAgentId; readonly start: number; readonly end: number; readonly at: FloorPosition; readonly facing: FloorPosition }
/** Folder segment: carried by an actor, passed from one actor's hands to another's, or held by Dana. */
export type FolderSegment =
  | { readonly kind: 'carry'; readonly actor: HandoffAgentId; readonly start: number; readonly end: number }
  | { readonly kind: 'pass'; readonly from: HandoffAgentId; readonly to: HandoffAgentId; readonly start: number; readonly end: number };
export interface Folder { readonly handoffId: string; readonly failed: boolean; readonly failAt: number; readonly segments: readonly FolderSegment[] }
export type BubbleTone = 'info' | 'fail' | 'passkey';
export interface Bubble { readonly actor: HandoffAgentId; readonly handoffId: string; readonly start: number; readonly end: number; readonly text: string; readonly tone: BubbleTone }
export interface Trip {
  readonly handoff: Handoff;
  readonly courier: HandoffAgentId;
  readonly receiver: HandoffAgentId;
  readonly start: number;
  /** Courier reaches the other desk. */
  readonly arrive: number;
  readonly end: number;
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

export interface PlanOptions { readonly speed?: number }
export function planHandoffs(rows: readonly Handoff[], { speed = 1 }: PlanOptions = {}): HandoffPlan {
  const pace = HANDOFF_WALK_SPEED * speed;
  const pass = PASS_MS / speed, check = CHECK_MS / speed, tail = BUBBLE_TAIL_MS / speed, hold = HUMAN_HOLD_MS / speed;
  const ordered = [...rows].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(-MAX_PLANNED);
  const free = new Map<HandoffAgentId, number>();
  const legs: Leg[] = [], holds: Hold[] = [], folders: Folder[] = [], bubbles: Bubble[] = [], trips: Trip[] = [];
  const human: [number, number][] = [], skipped: string[] = [];
  const freeAt = (id: HandoffAgentId) => free.get(id) ?? -Infinity;

  for (const row of ordered) {
    if (!isHandoffAgent(row.from) || !isHandoffAgent(row.to) || row.from === row.to || (row.from === HUMAN && row.to === HUMAN)) {
      skipped.push(row.id);
      continue;
    }
    const fromHuman = row.from === HUMAN, toHuman = row.to === HUMAN;
    const courier: HandoffAgentId = fromHuman ? row.to : row.from;
    const receiver: HandoffAgentId = fromHuman ? HUMAN : row.to;
    const giver: HandoffAgentId = fromHuman ? HUMAN : courier;
    const taker: HandoffAgentId = fromHuman ? courier : receiver;
    const start = Math.max(row.at, freeAt(courier), freeAt(receiver));
    const out = handoffRoute(courier, receiver);
    const back = reversed(out);
    const arrive = start + walkMs(out, pace);
    const passEnd = arrive + pass;
    const spot = handoffSpot(receiver);
    const receiverHome = HANDOFF_AGENTS[receiver].station, courierHome = HANDOFF_AGENTS[courier].station;
    const facingSender = courierHome;
    const failed = row.status === 'failed' && !fromHuman;
    // A failure reported after the pass still plays: the check ends when the failure arrived.
    const checkEnd = failed ? Math.max(passEnd + check, row.updatedAt ?? 0) : passEnd;

    legs.push({ actor: courier, start, end: arrive, route: out, returning: false });
    const segments: FolderSegment[] = [];
    if (fromHuman) {
      holds.push({ actor: courier, start: arrive, end: passEnd, at: spot, facing: receiverHome });
      segments.push({ kind: 'pass', from: giver, to: taker, start: arrive, end: passEnd });
    } else {
      segments.push({ kind: 'carry', actor: courier, start, end: arrive }, { kind: 'pass', from: giver, to: taker, start: arrive, end: passEnd });
    }
    let end: number;
    const bubbleText = failed ? `${row.item || 'Folder'} → ${handoffAgentName(receiver)}` : row.summary;
    bubbles.push({ actor: courier, handoffId: row.id, start: Math.max(start, arrive - 400 / speed), end: passEnd + tail, text: bubbleText, tone: toHuman && row.status === 'awaiting_passkey' ? 'passkey' : 'info' });

    if (toHuman) {
      const resolved = row.status === 'awaiting_passkey' ? Infinity : Math.max(passEnd + hold, row.updatedAt ?? 0);
      human.push([arrive, failed ? checkEnd + pass + hold : resolved]);
      if (row.status === 'awaiting_passkey') bubbles.push({ actor: HUMAN, handoffId: row.id, start: passEnd, end: Infinity, text: 'Passkey needed to approve', tone: 'passkey' });
      if (failed) {
        // Dana declines: the courier waits, takes the folder back and carries it home.
        holds.push({ actor: courier, start: arrive, end: checkEnd + pass, at: spot, facing: receiverHome });
        segments.push({ kind: 'carry', actor: HUMAN, start: passEnd, end: checkEnd }, { kind: 'pass', from: HUMAN, to: courier, start: checkEnd, end: checkEnd + pass });
        const home = checkEnd + pass + walkMs(back, pace);
        legs.push({ actor: courier, start: checkEnd + pass, end: home, route: back, returning: true });
        segments.push({ kind: 'carry', actor: courier, start: checkEnd + pass, end: home });
        bubbles.push({ actor: HUMAN, handoffId: row.id, start: passEnd, end: checkEnd + pass + tail, text: `✕ ${row.summary}`, tone: 'fail' });
        end = home;
        free.set(courier, home);
      } else {
        holds.push({ actor: courier, start: arrive, end: passEnd, at: spot, facing: receiverHome });
        const home = passEnd + walkMs(back, pace);
        legs.push({ actor: courier, start: passEnd, end: home, route: back, returning: false });
        if (row.status !== 'awaiting_passkey') segments.push({ kind: 'carry', actor: HUMAN, start: passEnd, end: resolved });
        else segments.push({ kind: 'carry', actor: HUMAN, start: passEnd, end: Infinity });
        end = home;
        free.set(courier, home);
      }
      free.set(HUMAN, end);
    } else if (fromHuman) {
      human.push([arrive, passEnd + hold]);
      const home = passEnd + walkMs(back, pace);
      legs.push({ actor: courier, start: passEnd, end: home, route: back, returning: false });
      segments.push({ kind: 'carry', actor: courier, start: passEnd, end: home });
      end = home;
      free.set(courier, home);
    } else if (failed) {
      holds.push({ actor: courier, start: arrive, end: passEnd, at: spot, facing: receiverHome });
      const senderBack = passEnd + walkMs(back, pace);
      legs.push({ actor: courier, start: passEnd, end: senderBack, route: back, returning: false });
      holds.push({ actor: receiver, start: arrive, end: checkEnd, at: receiverHome, facing: spot });
      segments.push({ kind: 'carry', actor: receiver, start: passEnd, end: checkEnd });
      // The receiver walks the folder back and waits for the sender to be home to take it.
      const returnRoute = handoffRoute(receiver, courier);
      const returnArrive = checkEnd + walkMs(returnRoute, pace);
      const passBack = Math.max(returnArrive, senderBack);
      const backHome = passBack + pass + walkMs(reversed(returnRoute), pace);
      legs.push({ actor: receiver, start: checkEnd, end: returnArrive, route: returnRoute, returning: true });
      const senderSpot = handoffSpot(courier);
      holds.push({ actor: receiver, start: returnArrive, end: passBack + pass, at: senderSpot, facing: facingSender });
      legs.push({ actor: receiver, start: passBack + pass, end: backHome, route: reversed(returnRoute), returning: false });
      segments.push({ kind: 'carry', actor: receiver, start: checkEnd, end: passBack }, { kind: 'pass', from: receiver, to: courier, start: passBack, end: passBack + pass });
      bubbles.push({ actor: receiver, handoffId: row.id, start: passEnd, end: passBack + pass + tail, text: `✕ ${row.summary}`, tone: 'fail' });
      end = backHome;
      free.set(courier, passBack + pass);
      free.set(receiver, backHome);
    } else {
      holds.push({ actor: courier, start: arrive, end: passEnd, at: spot, facing: receiverHome });
      const home = passEnd + walkMs(back, pace);
      legs.push({ actor: courier, start: passEnd, end: home, route: back, returning: false });
      end = home;
      free.set(courier, home);
      free.set(receiver, passEnd);
    }
    folders.push({ handoffId: row.id, failed, failAt: failed ? checkEnd : Infinity, segments });
    trips.push({ handoff: row, courier, receiver, start, arrive, end });
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
export interface FolderFrame { readonly handoffId: string; readonly position: [number, number, number]; readonly failed: boolean }
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
      folders.push({ handoffId: folder.handoffId, position: handOf(actors.get(segment.actor)!), failed });
    } else {
      const t = Math.min(1, Math.max(0, (now - segment.start) / Math.max(1e-9, segment.end - segment.start)));
      const ease = t * t * (3 - 2 * t);
      const a = handOf(actors.get(segment.from)!), b = handOf(actors.get(segment.to)!);
      // A small arc so the pass reads as a hand-over rather than a slide.
      folders.push({ handoffId: folder.handoffId, failed, position: [a[0] + (b[0] - a[0]) * ease, a[1] + (b[1] - a[1]) * ease + Math.sin(Math.PI * ease) * 0.18, a[2] + (b[2] - a[2]) * ease] });
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
  if (live) return rows.find(row => row.id === live.handoff.id) ?? live.handoff;
  return rows.filter(row => row.from === actor || row.to === actor).sort((a, b) => b.at - a.at)[0];
}

/**
 * Shared, mutable holder (like MotionRegistry) so Office (initial bundle), the lazy scene and the
 * Play rig read one plan. Re-plans only when the row array changes.
 */
export class HandoffStage {
  private rows: readonly Handoff[] = [];
  plan: HandoffPlan = EMPTY_PLAN;
  constructor(readonly speed = 1) {}
  update(rows: readonly Handoff[]): boolean {
    if (rows === this.rows) return false;
    this.rows = rows;
    this.plan = rows.length ? planHandoffs(rows, { speed: this.speed }) : EMPTY_PLAN;
    return true;
  }
  get current(): readonly Handoff[] { return this.rows; }
  sample(now: number, reduced = false): HandoffFrame { return sampleHandoffs(this.plan, now, { reduced }); }
  handoffFor(actor: string, now: number) { return handoffFor(this.plan, this.rows, actor, now); }
}
