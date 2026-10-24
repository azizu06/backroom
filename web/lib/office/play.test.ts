import { describe, expect, it } from "vitest";
import {
  DESK_RADIUS, DESK_SIZE, EYE_HEIGHT, INTERACT_RANGE, PAYLINK_KIOSK, PAYLINK_RADIUS, PITCH_LIMIT, PLAYER_RADIUS, SERVER_ROOM, SERVER_ROOM_BOX, SPAWN, TREASURY_DOOR, PlayInput, applyLook, headBob, insideAny,
  interactCandidates, moveIntent, movePlayer, officeColliders, pickTarget, playPanel, targetKey, targetLabel, turnIntent,
  type PlayCandidate, type Vec2,
} from "./play";
import { createMockOfficeState } from "./preview";
import { OFFICE_ANCHORS, type AnchorId } from "./state";

const ALL = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const colliders = officeColliders(ALL);

/** Walks in small steps (one per 1/60 s frame) toward a world direction. */
function walk(from: Vec2, direction: Vec2, distance: number, boxes = colliders): [number, number] {
  let position: [number, number] = [from[0], from[1]];
  const steps = Math.ceil(distance / 0.05);
  for (let i = 0; i < steps; i++) {
    position = movePlayer(position, [direction[0] * 0.05, direction[1] * 0.05], boxes, PLAYER_RADIUS);
    expect(insideAny(position, boxes, PLAYER_RADIUS)).toBe(false);
  }
  return position;
}

describe("play constants", () => {
  it("spawns in the lobby aisle facing the Collections desk, outside every collider", () => {
    expect(EYE_HEIGHT).toBeGreaterThan(1.4);
    expect(SPAWN.yaw).toBe(0);
    expect(insideAny(SPAWN.position, colliders, PLAYER_RADIUS)).toBe(false);
  });
});

describe("collisions", () => {
  it("cannot walk through a desk", () => {
    // From the Collections aisle straight into the desk top at z -2.475.
    const end = walk([-5, -1.5], [0, -1], 3);
    expect(end[1]).toBeGreaterThan(-2.475 + PLAYER_RADIUS - 0.01);
  });

  it("cannot walk through a partition and slides along it", () => {
    const end = walk([-3.5, -3], [1, 0], 3);
    expect(end[0]).toBeLessThan(-2.44 - PLAYER_RADIUS + 0.01);
    const slid = walk([-3.5, -3], [Math.SQRT1_2, Math.SQRT1_2], 2);
    expect(slid[0]).toBeLessThan(-2.44 - PLAYER_RADIUS + 0.01);
    expect(slid[1]).toBeGreaterThan(-3 + 1);
  });

  it("clamps to the floor bounds", () => {
    expect(walk([-6, 0.5], [-1, 0], 5)[0]).toBeCloseTo(-8 + PLAYER_RADIUS, 5);
    expect(movePlayer([0, 0.5], [0, 20], [], PLAYER_RADIUS)).toEqual([0, 5.5 - PLAYER_RADIUS]);
  });

  it("never ends inside a collider even for a large step", () => {
    const end = movePlayer([-5, -1.5], [0, -10], colliders, PLAYER_RADIUS);
    expect(insideAny(end, colliders, PLAYER_RADIUS)).toBe(false);
    expect(end[1]).toBeGreaterThan(-2.5);
  });

  it("cannot reach the vault through or around the locked Treasury door", () => {
    const inTreasury = (p: Vec2) => p[0] > 2.5 && p[1] > 1.6;
    const starts: Vec2[] = [[5, 0.6], [2.3, 0.6], [7.6, 0.6], [3, 0.4], [1.5, 0.6]];
    for (const start of starts) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
        const end = walk(start, [Math.sin(angle), Math.cos(angle)], 8);
        expect(inTreasury(end)).toBe(false);
      }
    }
    // Sliding along the barrier toward the partition finds no gap.
    expect(inTreasury(walk([3, 0.6], [-0.3, 1], 10))).toBe(false);
    // No gap past the partition's end at the back wall either (plant removed to test the partition alone).
    const noPlant = colliders.filter(c => !(c.minX === 1.2 && c.minZ === 4));
    expect(noPlant).toHaveLength(colliders.length - 1);
    expect(inTreasury(walk([1.9, 5.2], [1, 0], 10, noPlant))).toBe(false);
  });

  it("lets the player walk out of a collider that appeared on top of them", () => {
    const trap = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const out = movePlayer([0, 0.2], [0, 0.05], [trap], PLAYER_RADIUS);
    expect(out).toEqual([0, 0.25]);
  });
  it("accepts extra room geometry as solid footprints", () => {
    const extra = { minX: 6, maxX: 7.5, minZ: 0.2, maxZ: 0.8 };
    const withRoom = officeColliders(ALL, [extra]);
    expect(withRoom).toContainEqual(extra);
    expect(withRoom).toHaveLength(colliders.length + 1);
    const stopped = walk([4, 0.5], [1, 0], 3.5, withRoom);
    expect(stopped[0]).toBeLessThanOrEqual(extra.minX - PLAYER_RADIUS + 1e-6);
  });
  it("makes the GX10 server room solid at its footprint", () => {
    for (const [key, value] of Object.entries({ minX: 6.5, maxX: 7.7, minZ: -1.325, maxZ: -0.275 })) {
      expect(SERVER_ROOM_BOX[key as keyof typeof SERVER_ROOM_BOX]).toBeCloseTo(value, 9);
    }
    const withServer = officeColliders(ALL, [SERVER_ROOM_BOX]);
    expect(insideAny(SPAWN.position, withServer, PLAYER_RADIUS)).toBe(false);
    const fromFront = walk([7.1, 0.4], [0, -1], 2, withServer);
    expect(fromFront[1]).toBeCloseTo(SERVER_ROOM_BOX.maxZ + PLAYER_RADIUS, 3);
    const fromWest = walk([6.1, -0.8], [1, 0], 2, withServer);
    expect(fromWest[0]).toBeCloseTo(SERVER_ROOM_BOX.minX - PLAYER_RADIUS, 3);
    // Without the extra footprint the same walk passes through.
    expect(walk([6.1, -0.8], [1, 0], 2)[0]).toBeGreaterThan(SERVER_ROOM_BOX.maxX);
  });
  it("drops colliders for rooms that are not visible", () => {
    const withoutTreasury = officeColliders(ALL.filter(room => room !== "treasury"));
    expect(withoutTreasury.length).toBeLessThan(colliders.length);
    expect(walk([5, 0.6], [0, 1], 3, withoutTreasury)[1]).toBeGreaterThan(1.6);
  });
});

describe("input", () => {
  it("is active while anything is held or pending and clears", () => {
    const input = new PlayInput();
    expect(input.active()).toBe(false);
    input.press("forward");
    expect(input.active()).toBe(true);
    input.release("forward");
    input.look(0.1, 0);
    expect(input.active()).toBe(true);
    expect(input.consumeLook()).toEqual([0.1, 0]);
    expect(input.active()).toBe(false);
    input.setJoystick(3, 4);
    expect(Math.hypot(...input.joystick)).toBeCloseTo(1);
    input.clear();
    expect(input.active()).toBe(false);
  });

  it("moves forward toward -z at yaw 0 and strafes right toward +x", () => {
    const input = new PlayInput();
    input.press("forward");
    const [dx, dz] = moveIntent(input, 0, 0.5);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(-1.5);
    input.release("forward");
    input.press("right");
    expect(moveIntent(input, 0, 1)[0]).toBeCloseTo(3);
    input.press("forward");
    expect(Math.hypot(...moveIntent(input, 0, 1))).toBeCloseTo(3);
    input.clear();
    input.press("turnLeft");
    expect(turnIntent(input, 1)).toBeGreaterThan(0);
  });

  it("clamps look pitch", () => {
    expect(applyLook(0, 0, 0, 5).pitch).toBe(PITCH_LIMIT);
    expect(applyLook(0, 0, 0, -5).pitch).toBe(-PITCH_LIMIT);
    expect(applyLook(0, 1, 0.5, -0.2)).toEqual({ yaw: 0.5, pitch: 0.8 });
    expect(Math.abs(applyLook(3, 0, 1, 0).yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it("head bob is exactly zero when reduced or idle", () => {
    expect(headBob(1.3, true, true)).toBe(0);
    expect(headBob(1.3, false, false)).toBe(0);
    expect(headBob(0.2, true, false)).not.toBe(0);
    expect(Math.abs(headBob(0.2, true, false))).toBeLessThan(0.1);
  });
});

describe("targets", () => {
  const alex: PlayCandidate = { target: { kind: "agent", id: "a" }, position: [0, -1.2], radius: 0.45 };
  it("picks in range, ignores out of range, behind and outside the cone", () => {
    expect(pickTarget([0, 0], 0, [alex])).toEqual({ kind: "agent", id: "a" });
    expect(pickTarget([0, 3], 0, [alex])).toBeNull();
    expect(pickTarget([0, 0], Math.PI, [alex])).toBeNull();
    expect(pickTarget([0, 0], 0.6, [alex])).toBeNull();
    expect(pickTarget([0, 0], 0.2, [alex])).not.toBeNull();
    expect(pickTarget([0, -0.4], 0, [alex])).not.toBeNull();
    expect(pickTarget([0, -1.6 - INTERACT_RANGE], 0, [alex])).toBeNull();
  });

  it("widens the cone up close so the target under you stays picked", () => {
    // 0.5 m from Alex and 0.6 rad off: outside PICK_CONE but still on the agent (asin(0.45 / 0.5) ≈ 1.12).
    expect(pickTarget([0, -0.7], 0.6, [alex])).toEqual(alex.target);
    expect(pickTarget([0, -0.7], 1.3, [alex])).toBeNull();
  });

  it("prefers the nearest and agents on ties", () => {
    const desk: PlayCandidate = { target: { kind: "desk", room: "payables" }, position: [0, -1.2], radius: DESK_RADIUS };
    const far: PlayCandidate = { target: { kind: "agent", id: "far" }, position: [0, -1.5], radius: 0.45 };
    expect(pickTarget([0, 0], 0, [desk, alex])).toEqual(alex.target);
    expect(pickTarget([0, 0], 0, [far, alex])).toEqual(alex.target);
    const nearDesk: PlayCandidate = { ...desk, position: [0, -1] };
    expect(pickTarget([0, 0], 0, [far, nearDesk])).toEqual(nearDesk.target);
  });

  it("walking forward from SPAWN reaches Alex's interact range", () => {
    const { source } = createMockOfficeState();
    const snapshot = source.getSnapshot();
    const candidates = interactCandidates(snapshot.agents.map(agent => ({ id: agent.id, position: agent.pos })), ALL);
    expect(pickTarget(SPAWN.position, SPAWN.yaw, candidates)).toBeNull();
    let position: [number, number] = [SPAWN.position[0], SPAWN.position[1]];
    const input = new PlayInput();
    input.press("forward");
    let found = null;
    for (let i = 0; i < 120 && found?.kind !== "agent"; i++) {
      position = movePlayer(position, moveIntent(input, SPAWN.yaw, 1 / 60), colliders);
      found = pickTarget(position, SPAWN.yaw, candidates, INTERACT_RANGE);
    }
    expect(found).toEqual({ kind: "agent", id: "collections-clerk" });
    // Found while still walking: the Collections desk stops the player further on.
    const stop = walk(SPAWN.position, [0, -1], 6);
    expect(stop[1]).toBeCloseTo(OFFICE_ANCHORS.collections.center[1] + DESK_SIZE.depth / 2 + PLAYER_RADIUS, 2);
    expect(position[1]).toBeGreaterThan(stop[1] + 0.5);
    // Alex is not solid, so you can walk right up to him and keep the prompt.
    const alexAt = OFFICE_ANCHORS.collections.position;
    expect(pickTarget([alexAt[0], alexAt[1] + 0.3], SPAWN.yaw, candidates)).toEqual({ kind: "agent", id: "collections-clerk" });
    // At the desk the desk is offered.
    expect(pickTarget(stop, SPAWN.yaw, candidates)).toEqual({ kind: "desk", room: "collections" });
  });

  it("does not offer a desk from across the aisle", () => {
    const candidates = interactCandidates([], ALL).filter(candidate => candidate.target.kind === "desk");
    for (const room of ["collections", "payables", "vendor_onboarding"] as const) {
      const [x, z] = OFFICE_ANCHORS[room].center;
      const edge = z + DESK_SIZE.depth / 2;
      expect(pickTarget([x, edge + 2.5], 0, candidates)).toBeNull();
      expect(pickTarget([x, edge + 1.5], 0, candidates)).toBeNull();
      expect(pickTarget([x, edge + 0.9], 0, candidates)).toEqual({ kind: "desk", room });
    }
    const [dx, dz] = OFFICE_ANCHORS.dana.center;
    expect(pickTarget([dx, dz - DESK_SIZE.depth / 2 - 2.5], Math.PI, candidates)).toBeNull();
    expect(pickTarget([dx, dz - DESK_SIZE.depth / 2 - 0.9], Math.PI, candidates)).toEqual({ kind: "desk", room: "dana" });
  });

  it("offers the Treasury door only when the room is visible", () => {
    const visible = interactCandidates([], ALL);
    expect(visible.some(c => c.target.kind === "treasury" && c.position === TREASURY_DOOR)).toBe(true);
    expect(interactCandidates([], ["lobby", "collections"]).map(c => targetKey(c.target))).toEqual(["desk:collections", "paylink", "server", "prop:clock", "prop:monitor:collections"]);
    expect(pickTarget([5, 0.6], Math.PI, visible)).toEqual({ kind: "treasury" });
  });

  it("picks the GX10 server when standing in front of it facing it", () => {
    const candidates = interactCandidates([], ALL);
    expect(candidates).toContainEqual({ target: { kind: "server" }, position: SERVER_ROOM.position, radius: SERVER_ROOM.size.width / 2 });
    expect(interactCandidates([], []).map(c => targetKey(c.target))).toEqual(["server"]);
    const front: Vec2 = [SERVER_ROOM.position[0], SERVER_ROOM_BOX.maxZ + PLAYER_RADIUS + 0.1];
    expect(pickTarget(front, 0, candidates)).toEqual({ kind: "server" });
    expect(pickTarget(front, Math.PI, candidates)).not.toEqual({ kind: "server" });
    expect(pickTarget([0, 0.4], -Math.PI / 2, candidates)).toBeNull();
  });

  it("offers the Treasury door where the browser test stands and where the barrier stops you, not from afar", () => {
    const visible = interactCandidates([], ALL);
    expect(pickTarget([5, 0.45], Math.PI, visible)).toEqual({ kind: "treasury" });
    const stop = walk([5, 0.45], [0, 1], 2);
    expect(stop[1]).toBeCloseTo(1.05 - PLAYER_RADIUS, 2);
    expect(pickTarget(stop, Math.PI, visible)).toEqual({ kind: "treasury" });
    expect(pickTarget([5, 3.0], 0, visible)).toBeNull();
    expect(pickTarget([5, -1], Math.PI, visible)).toBeNull();
  });

  it("offers the payment link kiosk only when the lobby is visible", () => {
    const kiosk = interactCandidates([], ALL).filter(c => c.target.kind === "paylink");
    expect(kiosk).toEqual([{ target: { kind: "paylink" }, position: PAYLINK_KIOSK, radius: PAYLINK_RADIUS }]);
    expect(interactCandidates([], ALL.filter(room => room !== "lobby")).some(c => c.target.kind === "paylink")).toBe(false);
    expect(targetKey({ kind: "paylink" })).toBe("paylink");
  });

  it("picks the kiosk when facing it within range, from outside its counter", () => {
    const candidates = interactCandidates([], ["lobby"]);
    const eye: Vec2 = [-4.4, 1.9];
    expect(insideAny(eye, colliders, PLAYER_RADIUS)).toBe(false);
    expect(pickTarget(eye, Math.PI, candidates)).toEqual({ kind: "paylink" });
    expect(pickTarget(eye, 0, candidates)).toBeNull();
    expect(pickTarget([-4.4, -1], Math.PI, candidates)).toBeNull();
  });
});

describe("panels", () => {
  it("describes an agent with its task and newest audit entries", () => {
    const mock = createMockOfficeState();
    mock.setTargetAnchor("dana");
    const snapshot = mock.source.getSnapshot();
    const panel = playPanel(snapshot, { kind: "agent", id: "collections-clerk" })!;
    expect(panel.title).toBe("Alex · collections-clerk");
    expect(panel.state).toContain("awaiting Dana");
    expect(panel.task).toContain("Dana’s desk");
    expect(panel.task).toContain("preview-escalation-1042");
    expect(panel.entries[0]).toMatchObject({ decision: "ESCALATE", ruleIds: ["MAX_INSTALLMENTS"] });
    expect(targetLabel(snapshot, { kind: "agent", id: "collections-clerk" })).toBe("Talk to Alex");
    expect(playPanel(snapshot, { kind: "agent", id: "gone" })).toBeNull();
  });

  it("lists at most eight agent entries, newest first", () => {
    const mock = createMockOfficeState();
    for (let i = 0; i < 10; i++) mock.denyTreasury();
    const panel = playPanel(mock.source.getSnapshot(), { kind: "agent", id: "collections-clerk" })!;
    expect(panel.entries).toHaveLength(8);
    expect(panel.entries[0]!.id).toBe("preview-denial-9");
  });

  it("describes a desk with its badge and seated agents", () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const panel = playPanel(snapshot, { kind: "desk", room: "collections" })!;
    expect(panel.title).toBe("Collections");
    expect(panel.badge?.policyVersion).toBe(snapshot.badges.find(b => b.seatId === "collections")!.policyVersion);
    expect(panel.seated).toEqual([{ id: "collections-clerk", name: "Alex", state: "Reviewing invoice 1042" }]);
    expect(panel.entries).toEqual([]);
    expect(targetLabel(snapshot, { kind: "desk", room: "collections" })).toBe("Inspect Collections desk");
    expect(playPanel(snapshot, { kind: "desk", room: "dana" })!.badge).toBeUndefined();
  });

  it("shows the Treasury as locked, with the denial when one matches", () => {
    const mock = createMockOfficeState();
    const locked = playPanel(mock.source.getSnapshot(), { kind: "treasury" })!;
    expect(locked).toMatchObject({ title: "Treasury", locked: "Locked · Dana only" });
    expect(locked.denial).toBeUndefined();
    mock.denyTreasury();
    const denied = playPanel(mock.source.getSnapshot(), { kind: "treasury" })!;
    expect(denied.denial).toMatchObject({ id: "preview-denial-0", decision: "DENY", ruleIds: ["NOT_IN_BADGE"] });
    expect(targetLabel(mock.source.getSnapshot(), { kind: "treasury" })).toBe("Treasury door");
  });

  it("describes the payment link kiosk with no audit entries", () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    expect(playPanel(snapshot, { kind: "paylink" })).toEqual({ kind: "paylink", title: "Payment link kiosk", entries: [] });
    expect(targetLabel(snapshot, { kind: "paylink" })).toBe("Scan to pay · payment link kiosk");
  });

  it("describes the GX10 server without snapshot data", () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    expect(targetKey({ kind: "server" })).toBe("server");
    expect(targetLabel(snapshot, { kind: "server" })).toBe("Check GX10 server");
    expect(playPanel(snapshot, { kind: "server" })).toEqual({ kind: "server", title: "GX10 server", entries: [] });
  });
});
