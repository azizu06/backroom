import { OFFICE_ANCHORS, isAnchorId, type FloorPosition, type OfficeAgent } from "./state";

/** Visual interpolation only. Reaching a desk never triggers a business event. */
export class WalkMotion {
  readonly position: [number, number];
  heading = 0;
  distance = 0;
  moving = false;
  private route: FloorPosition[] = [];

  constructor(position: FloorPosition) {
    this.position = [...position];
  }

  /** Places the agent at a row position and stops any walk in progress. */
  seat(position: FloorPosition) {
    this.position[0] = position[0];
    this.position[1] = position[1];
    this.route = [];
    this.moving = false;
  }

  /** Unknown anchors (e.g. free-form live rows) leave the agent where it is. */
  moveTo(anchor: string) {
    if (!isAnchorId(anchor)) {
      this.route = [];
      this.moving = false;
      return;
    }
    const destination = OFFICE_ANCHORS[anchor].position;
    if (Math.hypot(destination[0] - this.position[0], destination[1] - this.position[1]) < 0.001) {
      this.route = [];
      this.moving = false;
      return;
    }
    // The central aisle keeps walks clear of the room furniture footprints.
    this.route = [[this.position[0], 0.6], [destination[0], 0.6], destination];
    this.moving = true;
  }

  advance(delta: number) {
    let budget = Math.min(Math.max(delta, 0), 0.1) * 2.4;
    while (this.route.length && budget > 0) {
      const waypoint = this.route[0]!;
      const dx = waypoint[0] - this.position[0];
      const dz = waypoint[1] - this.position[1];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.001) { this.route.shift(); continue; }
      this.heading = Math.atan2(dx, dz);
      const step = Math.min(budget, distance);
      this.position[0] += dx / distance * step;
      this.position[1] += dz / distance * step;
      this.distance += step;
      budget -= step;
      if (step === distance) {
        this.position[0] = waypoint[0];
        this.position[1] = waypoint[1];
        this.route.shift();
      }
    }
    this.moving = this.route.length > 0;
  }
}

/**
 * One WalkMotion per agent id, shared by every view (floor plan and 3D scene)
 * so switching views keeps an agent's current position mid-walk.
 */
export class MotionRegistry {
  private readonly entries = new Map<string, { motion: WalkMotion; target?: string; pos?: FloorPosition }>();
  private recorded = false;

  /** Returns the agent's motion, creating it at the row's position on first sight. */
  get(agent: Pick<OfficeAgent, "id" | "pos">): WalkMotion {
    let entry = this.entries.get(agent.id);
    if (!entry) {
      entry = { motion: new WalkMotion(agent.pos) };
      this.entries.set(agent.id, entry);
    }
    return entry.motion;
  }

  /**
   * Applies a snapshot: a changed row `pos` re-seats the motion and walks on to the target,
   * a changed anchor retargets, and agents that left are disposed. Recorded (replay) rows
   * pin the motion to `pos` so it never walks on its own; leaving replay walks every agent
   * on to its target. Returns true when anything a view draws changed (an on-demand renderer
   * should request a frame).
   */
  sync(agents: readonly Pick<OfficeAgent, "id" | "pos" | "targetAnchor">[], { recorded = false } = {}): boolean {
    const resumed = this.recorded && !recorded;
    let changed = this.recorded !== recorded;
    this.recorded = recorded;
    const present = new Set<string>();
    for (const agent of agents) {
      present.add(agent.id);
      const motion = this.get(agent);
      const entry = this.entries.get(agent.id)!;
      const seen = !!entry.pos;
      const moved = seen && (entry.pos![0] !== agent.pos[0] || entry.pos![1] !== agent.pos[1]);
      if (!seen || moved) changed = true;
      entry.pos = [agent.pos[0], agent.pos[1]];
      if (recorded) {
        motion.seat(agent.pos);
        entry.target = agent.targetAnchor;
        continue;
      }
      if (moved) motion.seat(agent.pos);
      if (moved || resumed || entry.target !== agent.targetAnchor) {
        entry.target = agent.targetAnchor;
        motion.moveTo(agent.targetAnchor);
        changed = true;
      }
    }
    for (const id of this.entries.keys()) if (!present.has(id)) { this.entries.delete(id); changed = true; }
    return changed;
  }

  has(id: string) {
    return this.entries.has(id);
  }

  get size() {
    return this.entries.size;
  }

  get moving() {
    for (const { motion } of this.entries.values()) if (motion.moving) return true;
    return false;
  }
}
