import { createGateway } from "./http";
import { MemoryGatewayStore, type GatewayStore } from "./store";

// All tool routes share this one module. Replace at server bootstrap with a
// durable adapter before a multi-instance deployment; never seed from model input.
let store: GatewayStore = new MemoryGatewayStore();
export function installGatewayStore(adapter: GatewayStore): void {
  store = adapter;
}
export const handleTool = createGateway({
  secret: () => process.env.TOOL_GATEWAY_SECRET,
  store: { transact: (callId, work) => store.transact(callId, work) },
});
