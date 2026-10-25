import { describe, expect, it } from "vitest";
import {
  DESK_RADIUS, DESK_SIZE, EYE_HEIGHT, INTERACT_RANGE, PAYLINK_KIOSK, PAYLINK_RADIUS, PITCH_LIMIT, PLAYER_RADIUS, SERVER_ROOM, SERVER_ROOM_BOX, SPAWN, TREASURY_DOOR, TURN_SPEED, PlayInput, applyLook, headBob, insideAny,
  applyTurnTap, frameLookYaw, interactCandidates, moveIntent, movePlayer, officeColliders, pickTarget, playPanel, targetKey, targetLabel, turnIntent,
  type PlayCandidate, type PlayTarget, type Vec2,
} from "./play";
import { createMockOfficeState } from "./preview";
import { OFFICE_ANCHORS, type AnchorId } from "./state";
import { BUILDING, DOORWAYS, WALL_THICKNESS, spaceAt } from "./layout";
import { doorPosition } from "./doors";
import { roomPropColliders } from './room-props';
import { PINGPONG_COLLIDER } from './pingpong/table';
import { WING_COLLIDERS } from './wing';

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
  it("spawns in the corridor by the lobby facing the Collections desk, outside every collider", () => {
    expect(EYE_HEIGHT).toBeGreaterThan(1.4);
    expect(SPAWN.yaw).toBe(0);
    expect(insideAny(SPAWN.position, colliders, PLAYER_RADIUS)).toBe(false);
  });
});

describe("collisions", () => {
  const [cx, cz] = OFFICE_ANCHORS.collections.center;
  const wallFace = WALL_THICKNESS / 2;
  it('detaches leisure colliders and retains every shared workstation', () => {
    expect(officeColliders([])).not.toContainEqual(PINGPONG_COLLIDER);
    const [x, z] = OFFICE_ANCHORS.collections.center;
    expect(insideAny([x, z], officeColliders([]), 0)).toBe(true);
  });

  it("cannot walk through a desk", () => {
    // From inside Collections straight into the desk front.
    const end = walk([cx, cz + 2.5], [0, -1], 3);
    expect(end[1]).toBeGreaterThan(cz + DESK_SIZE.depth / 2 + PLAYER_RADIUS - 0.01);
  });

  it('walks across the removed department partitions in the clear main aisle', () => {
    expect(walk([-7, 0], [1, 0], 5)).toEqual(expect.arrayContaining([expect.closeTo(-2, 5), 0]));
  });

  it("stops at the outer walls and clamps to the floor bounds", () => {
    expect(walk([-21, -0.5], [-1, 0], 5)[0]).toBeCloseTo(BUILDING.minX + wallFace + PLAYER_RADIUS, 3);
    expect(walk([-0.8, 6], [0, 1], 5)[1]).toBeCloseTo(BUILDING.maxZ - wallFace - PLAYER_RADIUS, 3);
    expect(movePlayer([0, 0.5], [0, 20], [], PLAYER_RADIUS)).toEqual([0, BUILDING.maxZ - wallFace - PLAYER_RADIUS]);
  });

  it('keeps the street entrance solid while the department aisles stay open', () => {
    const door = DOORWAYS.find(door => door.id === 'entrance')!;
    expect(walk([door.at[0], door.at[1] - 1], [0, 1], 2)[1]).toBeLessThan(door.at[1]);
    expect(walk([-11, 0], [1, 0], 20)[0]).toBeCloseTo(9);
  });

  it("never ends inside a collider even for a large step", () => {
    const end = movePlayer([cx, cz + 2.5], [0, -10], colliders, PLAYER_RADIUS);
    expect(insideAny(end, colliders, PLAYER_RADIUS)).toBe(false);
    expect(end[1]).toBeGreaterThan(cz + DESK_SIZE.depth / 2);
  });

  it('keeps the vault itself solid in the open office', () => {
    const [tx, tz] = OFFICE_ANCHORS.treasury.center;
    expect(insideAny([tx, tz + 0.6], colliders, 0)).toBe(true);
    expect(walk([tx, tz - 1], [0, 1], 3)[1]).toBeLessThan(tz + 0.6 - 0.625);
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
    for (const [key, value] of Object.entries({ minX: 10.3, maxX: 11.5, minZ: -1.325, maxZ: -0.275 })) {
      expect(SERVER_ROOM_BOX[key as keyof typeof SERVER_ROOM_BOX]).toBeCloseTo(value, 9);
    }
    expect(spaceAt(SERVER_ROOM.position)).toBe("server_room");
    const withServer = officeColliders(ALL, [SERVER_ROOM_BOX]);
    expect(insideAny(SPAWN.position, withServer, PLAYER_RADIUS)).toBe(false);
    const fromFront = walk([SERVER_ROOM.position[0], 0.4], [0, -1], 2, withServer);
    expect(fromFront[1]).toBeCloseTo(SERVER_ROOM_BOX.maxZ + PLAYER_RADIUS, 3);
    const fromWest = walk([9.9, -0.6], [1, 0], 2, withServer);
    expect(fromWest[0]).toBeCloseTo(SERVER_ROOM_BOX.minX - PLAYER_RADIUS, 3);
    // Without the extra footprint the same walk passes through.
    expect(walk([9.9, -0.6], [1, 0], 2)[0]).toBeGreaterThan(SERVER_ROOM_BOX.maxX);
  });
  it('keeps shared pod geometry stable when live department rows are absent', () => {
    const withoutCollections = officeColliders(ALL.filter(room => room !== 'collections'));
    expect(insideAny(OFFICE_ANCHORS.collections.center, withoutCollections, 0)).toBe(true);
    expect(walk([-11, 0], [1, 0], 20, withoutCollections)[0]).toBeCloseTo(9);
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

  it("a released turn-key tap still yaws one frame", () => {
    const input = new PlayInput();
    applyTurnTap(input, "turnLeft");
    applyTurnTap(input, "forward");
    input.press("turnLeft");
    expect(input.active()).toBe(true);
    input.release("turnLeft");
    expect(turnIntent(input, 1 / 60)).toBe(0);
    expect(input.consumeTurnTap()).toBeCloseTo(TURN_SPEED / 60);
    applyTurnTap(input, "turnRight");
    expect(input.consumeTurnTap()).toBeCloseTo(-TURN_SPEED / 60);
    // A keydown both queues a tap and holds the key. The held frame wins so the tap is not applied twice.
    expect(frameLookYaw(0.1, TURN_SPEED / 60, TURN_SPEED / 60)).toBeCloseTo(0.1 + TURN_SPEED / 60);
    expect(frameLookYaw(0.1, 0, -TURN_SPEED / 60)).toBeCloseTo(0.1 - TURN_SPEED / 60);
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

  it("prefers the nearest agent and agents over desks on ties", () => {
    const desk: PlayCandidate = { target: { kind: "desk", room: "payables" }, position: [0, -1.2], radius: DESK_RADIUS };
    const far: PlayCandidate = { target: { kind: "agent", id: "far" }, position: [0, -1.5], radius: 0.45 };
    expect(pickTarget([0, 0], 0, [desk, alex])).toEqual(alex.target);
    expect(pickTarget([0, 0], 0, [far, alex])).toEqual(alex.target);
  });

  it("keeps an agent ahead of the player targeted when a surrounding desk has a nearer centre", () => {
    const desk: PlayCandidate = { target: { kind: "desk", room: "collections" }, position: [0, -1], radius: DESK_RADIUS };
    for (const candidates of [[desk, alex], [alex, desk]]) {
      const target = pickTarget([0, 0], 0, candidates);
      expect(target).toEqual(alex.target);
      // Looking back at the desk leaves the agent behind the player.
      expect(pickTarget([0, -1.1], Math.PI, candidates)).toEqual(desk.target);
    }
    // A nearer closed leaf still blocks talking through the door.
    const closed: PlayCandidate = { target: { kind: "door", room: "collections" }, position: [0, -1.1], radius: 0.3, blocksInteraction: true };
    expect(pickTarget([0, 0], 0, [desk, alex, closed])).toEqual(desk.target);
  });

  it("offers no removed cosmetic door targets", () => {
    expect(interactCandidates([], ALL).some(candidate => candidate.target.kind === 'door')).toBe(false);
  });

  it("gives every other eligible target priority over a door, including ties and near-ties", () => {
    const door: PlayCandidate = { target: { kind: "door", room: "payables" }, position: [0, -0.4], radius: 0.1 };
    const targets: PlayTarget[] = [alex.target, { kind: "desk", room: "payables" }, { kind: "phone" },
      { kind: "treasury" }, { kind: "paylink" }, { kind: "server" }, { kind: "coworker", id: "other", name: "Other" },
      { kind: "inbox" }, { kind: "folder" }];
    for (const target of targets) {
      for (const distance of [0.4, 0.41, 1.1]) {
        const other: PlayCandidate = { target, position: [0, -distance], radius: 0.1 };
        expect(pickTarget([0, 0], 0, [door, other])).toEqual(target);
        expect(pickTarget([0, 0], 0, [other, door])).toEqual(target);
      }
    }
    expect(pickTarget([0, -0.35], 0.8, [door])).toBeNull();
  });

  it("walking forward from SPAWN reaches Alex's interact range", () => {
    const { source } = createMockOfficeState();
    const snapshot = source.getSnapshot();
    const candidates = interactCandidates(snapshot.agents.map(agent => ({ id: agent.id, position: agent.pos })), ALL);
    expect(pickTarget(SPAWN.position, SPAWN.yaw, candidates)).toEqual({ kind: "agent", id: "collections-clerk" });
    let position: [number, number] = [SPAWN.position[0], SPAWN.position[1]];
    const input = new PlayInput();
    input.press("forward");
    let found: PlayTarget | null = null;
    for (let i = 0; i < 120 && found === null; i++) {
      position = movePlayer(position, moveIntent(input, SPAWN.yaw, 1 / 60), colliders);
      found = pickTarget(position, SPAWN.yaw, candidates, INTERACT_RANGE);
    }
    expect(found).toEqual({ kind: "agent", id: "collections-clerk" });
    // Found while still walking: the Collections desk stops the player further on.
    const stop = walk(SPAWN.position, [0, -1], 6);
    expect(stop[1]).toBeCloseTo(OFFICE_ANCHORS.collections.center[1] + 0.9 + 0.325 + PLAYER_RADIUS, 2);
    expect(position[1]).toBeGreaterThan(stop[1] + 0.5);
    // Alex is not solid, so you can walk right up to him and keep the prompt.
    const alexAt = OFFICE_ANCHORS.collections.position;
    expect(pickTarget([alexAt[0], alexAt[1] + 0.3], SPAWN.yaw, candidates)).toEqual({ kind: "agent", id: "collections-clerk" });
    // At the desk the desk is offered.
    expect(pickTarget(stop, SPAWN.yaw, candidates)).toEqual({ kind: "desk", room: "collections" });
  });

  it("does not offer a desk from across the aisle", () => {
    const candidates = interactCandidates([], ALL);
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
    expect(interactCandidates([], ["lobby", "collections"]).map(c => targetKey(c.target))).toEqual(["desk:collections", "paylink", "phone", "server", "folder", "ticket-board"]);
    expect(pickTarget([TREASURY_DOOR[0], TREASURY_DOOR[1] - 0.55], Math.PI, visible)).toEqual({ kind: "treasury" });
  });

  it("picks the GX10 server when standing in front of it facing it", () => {
    const candidates = interactCandidates([], ALL);
    expect(candidates).toContainEqual({ target: { kind: "server" }, position: SERVER_ROOM.position, radius: SERVER_ROOM.size.width / 2 });
    expect(interactCandidates([], []).map(c => targetKey(c.target))).toEqual(["server", "ticket-board"]);
    const front: Vec2 = [SERVER_ROOM.position[0], SERVER_ROOM_BOX.maxZ + PLAYER_RADIUS + 0.1];
    expect(pickTarget(front, 0, candidates)).toEqual({ kind: "server" });
    expect(pickTarget(front, Math.PI, candidates)).not.toEqual({ kind: "server" });
    expect(pickTarget([0, 0.4], -Math.PI / 2, candidates)).toBeNull();
  });

  it("offers the Treasury door where the browser test stands and where the barrier stops you, not from afar", () => {
    const visible = interactCandidates([], ALL);
    const [tx, tz] = TREASURY_DOOR;
    expect(pickTarget([tx, tz - 0.7], Math.PI, visible)).toEqual({ kind: "treasury" });
    const stop = walk([tx, tz - 0.7], [0, 1], 2);
    expect(stop[1]).toBeCloseTo(OFFICE_ANCHORS.treasury.center[1] + 0.6 - 0.775 - PLAYER_RADIUS, 2);
    expect(pickTarget(stop, Math.PI, visible)).toEqual({ kind: "treasury" });
    expect(pickTarget([tx, tz + 1.85], 0, visible)).toBeNull();
    expect(pickTarget([tx, tz - 2.15], Math.PI, visible)).toBeNull();
  });

  it("offers the payment link kiosk only when the lobby is visible", () => {
    const kiosk = interactCandidates([], ALL).filter(c => c.target.kind === "paylink");
    expect(kiosk).toEqual([{ target: { kind: "paylink" }, position: PAYLINK_KIOSK, radius: PAYLINK_RADIUS }]);
    expect(interactCandidates([], ALL.filter(room => room !== "lobby")).some(c => c.target.kind === "paylink")).toBe(false);
    expect(targetKey({ kind: "paylink" })).toBe("paylink");
  });

  it("picks the kiosk when facing it within range, from outside its counter", () => {
    const candidates = interactCandidates([], ["lobby"]);
    const eye: Vec2 = [PAYLINK_KIOSK[0], PAYLINK_KIOSK[1] - 1.2];
    expect(insideAny(eye, colliders, PLAYER_RADIUS)).toBe(false);
    expect(pickTarget(eye, Math.PI, candidates)).toEqual({ kind: "paylink" });
    expect(pickTarget(eye, 0, candidates)).toBeNull();
    expect(pickTarget([PAYLINK_KIOSK[0], PAYLINK_KIOSK[1] - 4.1], Math.PI, candidates)).toBeNull();
  });
});

describe("panels", () => {
  it("talks as an agent, grounded in its state and newest audit entries", () => {
    const mock = createMockOfficeState();
    mock.setTargetAnchor("dana");
    const snapshot = mock.source.getSnapshot();
    const panel = playPanel(snapshot, { kind: "agent", id: "collections-clerk" })!;
    expect(panel.title).toBe("Talking with Alex");
    expect(panel.talk!.greeting.text).toContain("awaiting Dana");
    expect(panel.talk!.replies.stopped.text).toContain("preview-escalation-1042");
    expect(panel.talk!.replies.stopped.ruleIds).toEqual(["MAX_INSTALLMENTS"]);
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
