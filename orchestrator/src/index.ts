import { evaluate } from "@backroom/policy";

// Placeholder entry. Stream A: seat workers, task leases, the only caller of external APIs (spec §4.1 #4).
console.log("orchestrator placeholder", evaluate("collections", { type: "noop" }, { policyVersion: 0 }).kind);
