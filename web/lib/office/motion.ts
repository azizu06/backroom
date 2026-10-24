import { OFFICE_ANCHORS, type AnchorId, type FloorPosition } from "./state";

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

  moveTo(anchor: AnchorId) {
    const destination = OFFICE_ANCHORS[anchor].position;
    if (Math.hypot(destination[0] - this.position[0], destination[1] - this.position[1]) < 0.001) {
      this.route = [];
      this.moving = false;
      return;
    }
    // The clear aisle keeps the avatar out of the two desk footprints.
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
