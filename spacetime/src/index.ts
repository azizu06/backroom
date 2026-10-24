import { schema, table, t, SenderError } from "spacetimedb/server";
import { evaluate, type Badge } from "@backroom/policy";

const spacetimedb = schema({
  agent: table({ public: true }, {
    id: t.string().primaryKey(),
    seatId: t.string(),
    state: t.string(),
    room: t.string(),
    targetAnchor: t.string(),
    posX: t.f64(),
    posY: t.f64(),
    heartbeatAt: t.timestamp(),
    currentTaskId: t.string().optional(),
    modelRoute: t.string(),
  }),
  // T8 writer identity is the publisher. Never accept a caller-supplied badge.
  controller: table({}, {
    id: t.u8().primaryKey(),
    identity: t.identity(),
  }),
});
export default spacetimedb;

export const init = spacetimedb.init(ctx => {
  ctx.db.controller.insert({ id: 0, identity: ctx.sender });
  ctx.db.agent.insert({
    id: "collections-1", seatId: "collections", state: "idle",
    room: "collections", targetAnchor: "collections-desk", posX: 0, posY: 0,
    heartbeatAt: ctx.timestamp, currentTaskId: undefined, modelRoute: "none",
  });
});

export const request_room_entry = spacetimedb.reducer(
  { agentId: t.string(), room: t.string() },
  (ctx, { agentId, room }) => {
    if (!ctx.db.controller.id.find(0)?.identity.isEqual(ctx.sender)) {
      throw new SenderError("CONTROLLER_REQUIRED");
    }
    const agent = ctx.db.agent.id.find(agentId);
    if (!agent) throw new SenderError("AGENT_NOT_FOUND");
    const decision = evaluate(agent.seatId as Badge, { type: "enter_room", room }, {});
    if (decision.kind !== "ALLOW") {
      throw new SenderError(`${decision.kind}:${decision.ruleIds.join(",")}`);
    }
    ctx.db.agent.id.update({ ...agent, room, heartbeatAt: ctx.timestamp });
  },
);

export const set_agent_target = spacetimedb.reducer(
  { agentId: t.string(), targetAnchor: t.string() },
  (ctx, { agentId, targetAnchor }) => {
    if (!ctx.db.controller.id.find(0)?.identity.isEqual(ctx.sender)) {
      throw new SenderError("CONTROLLER_REQUIRED");
    }
    const agent = ctx.db.agent.id.find(agentId);
    if (!agent) throw new SenderError("AGENT_NOT_FOUND");
    if (!targetAnchor.trim() || targetAnchor.length > 120) throw new SenderError("INVALID_ANCHOR");
    ctx.db.agent.id.update({ ...agent, targetAnchor, heartbeatAt: ctx.timestamp });
  },
);
