/** Opt-in integration check against a disposable, already-published T8 database.
 * Run after opening /t8. Never run this against a production database.
 */
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

if (process.env.T8_LIVE !== "1") throw new Error("Set T8_LIVE=1 to mutate a disposable T8 database");
const cli = process.env.SPACETIME_CLI ?? "spacetime";
const root = process.env.SPACETIME_ROOT;
const server = process.env.T8_SERVER ?? "http://127.0.0.1:3108";
const database = process.env.T8_DATABASE ?? "backroom-t8-validation";
const prefix = root ? [`--root-dir=${root}`] : [];
const run = (...args) => execFileSync(cli, [...prefix, ...args, "--server", server], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const call = (name, ...args) => run("call", database, name, ...args);
const sql = () => run("sql", database, "SELECT * FROM agent");
const before = sql();
call("request_room_entry", "collections-1", "payables");
const denied = run("sql", database, "SELECT * FROM audit_entry WHERE action = 'request_room_entry' AND decision = 'DENY'");
if (sql() !== before || !denied.includes("NOT_IN_BADGE")) throw new Error("Disallowed room changed the agent or omitted DENY evidence");
console.log("PASS: policy refuses forbidden room; agent unchanged, DENY audit committed");

const unauthorized = await fetch(`${server}/v1/database/${database}/call/set_agent_target`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(["collections-1", "unauthorized-anchor"]),
});
if (unauthorized.ok || !(await unauthorized.text()).includes("CONTROLLER_REQUIRED") || sql() !== before) {
  throw new Error("Anonymous writer was not rejected without mutation");
}
console.log("PASS: anonymous writer rejected with CONTROLLER_REQUIRED; row unchanged");
call("request_room_entry", "collections-1", "collections");
console.log("PASS: allowed room write succeeds");

const runId = Date.now();
for (let i = 1; i <= 20; i++) {
  call("set_agent_target", "collections-1", `t8-sample-${runId}-${i}`);
  await setTimeout(125);
}
console.log(`Wrote 20 targets for run ${runId}; read /t8 [data-testid=latency-samples] for DOM latency`);
