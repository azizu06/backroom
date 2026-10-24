import { approvalState } from "../approvals/runtime";
import { createApprovalBridge } from "../approvals/gateway";
import { createGateway } from "./http";
import { MemoryGatewayStore, type GatewayStore } from "./store";

// All tool routes share this one module. Replace at server bootstrap with a
// durable adapter before a multi-instance deployment; never seed from model input.
const root = globalThis as typeof globalThis & { backroomGatewayStore?: GatewayStore };
root.backroomGatewayStore ??= new MemoryGatewayStore();
export function installGatewayStore(adapter: GatewayStore): void {
  root.backroomGatewayStore = adapter;
}
export const handleTool = createGateway({
  approvalBridge: createApprovalBridge(approvalState),
  secret: () => process.env.TOOL_GATEWAY_SECRET,
  store: { transact: (callId, work) => root.backroomGatewayStore!.transact(callId, work) },
});

export const getGatewayStore = (): GatewayStore => root.backroomGatewayStore!;
