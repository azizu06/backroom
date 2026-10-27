import { HANDOFF_AGENTS, isHandoffAgent } from './handoffs';
import { POD_BOUNDS, WORKSTATIONS, workstationApproach } from './layout';
import { DESK_SIZE } from './metrics';
import type { MotionRegistry } from './motion';
import { FLOOR, SERVER_ROOM_BOX } from './play';
import { placePlanLabels, type PlanRect } from './plan-labels';
import { OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from './state';

/** The subscribed roster is authoritative; role metadata supplies colours, never extra people. */
export function overviewMapAgents(snapshot: OfficeSnapshot, motions: MotionRegistry) {
  return snapshot.agents.map(agent => {
    const role = agent.id === 'dana' ? 'human' : agent.id.split('-')[0]!;
    const key = isHandoffAgent(role) ? role : agent.seatId === 'vendor_onboarding' ? 'vendor' : agent.seatId;
    const color = isHandoffAgent(key) ? HANDOFF_AGENTS[key].color : '#8fa7b8';
    const position = motions.get(agent).position;
    const seat = WORKSTATIONS.findIndex((_, index) => {
      const [x, z] = workstationApproach(index);
      return Math.hypot(x - position[0], z - position[1]) < 0.65;
    });
    return { ...agent, position, color, seat, human: key === 'human' };
  });
}

export function overviewMapLayout(width: number, height: number, rooms: readonly AnchorId[]) {
  const point = ([x, z]: readonly [number, number]) => ({
    x: (x - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX) * width,
    y: (z - FLOOR.minZ) / (FLOOR.maxZ - FLOOR.minZ) * height,
  });
  const rect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): PlanRect => ({
    ...point([r.minX, r.minZ]), width: (r.maxX - r.minX) / (FLOOR.maxX - FLOOR.minX) * width,
    height: (r.maxZ - r.minZ) / (FLOOR.maxZ - FLOOR.minZ) * height,
  });
  const compact = width < 480;
  const desks = WORKSTATIONS.map(({ center: [x, z] }) => rect({ minX: x - DESK_SIZE.width / 2,
    maxX: x + DESK_SIZE.width / 2, minZ: z - DESK_SIZE.depth / 2, maxZ: z + DESK_SIZE.depth / 2 }));
  const pods = POD_BOUNDS.map(rect);
  const server = rect(SERVER_ROOM_BOX);
  server.width = Math.max(38, server.width);
  server.height = Math.max(18, server.height);
  server.x = Math.max(4, Math.min(width - server.width - 4, server.x));
  server.y = Math.max(4, Math.min(height - server.height - 4, server.y));
  const labels = placePlanLabels(rooms.map(id => {
    const center = OFFICE_ANCHORS[id].center;
    const anchor = point(center);
    const pod = POD_BOUNDS.findIndex(p => center[0] >= p.minX && center[0] <= p.maxX && center[1] >= p.minZ && center[1] <= p.maxZ);
    return { id, anchor, beside: pods[pod] ?? { ...anchor, width: 0, height: 0 }, width: compact ? 100 : 148, height: compact ? 28 : 48 };
  }), { x: 0, y: 0, width, height }, [...pods, server]);
  return { compact, desks, labels, server };
}
