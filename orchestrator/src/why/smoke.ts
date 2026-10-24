/** Opt-in only: node --env-file=.env.local, or export credentials before running. */
import { readFile } from "node:fs/promises";
import { askWhy, type WhyAuditEntry } from "./index.js";

if (process.env.WHY_LIVE !== "1") throw new Error("Opt in with WHY_LIVE=1; this script makes three questions (up to six billable model calls).");
if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY server-side before running.");
const entries = JSON.parse(await readFile(new URL("../../../fixtures/why/audit-log.json", import.meta.url), "utf8")) as WhyAuditEntry[];
const key = JSON.parse(await readFile(new URL("../../../fixtures/why/answer-key.json", import.meta.url), "utf8")) as { question: string; correctIds: string[] }[];
for (const scenario of key) {
  // Haiku is the cheap Claude default; production can pass a stronger model through WhyOptions.
  const result = await askWhy(scenario.question, entries);
  if (result.source !== "model" || !result.citations.some(id => scenario.correctIds.includes(id))) {
    throw new Error(`Live grounding failed (${result.source}); no provider response or credentials logged.`);
  }
  console.log(JSON.stringify({ question: scenario.question, ...result }));
}
