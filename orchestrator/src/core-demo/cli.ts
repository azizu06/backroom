import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runNorthfieldPayables } from './northfield';
import { runCoreDemo, runInboxTrap } from './core';
import type { DemoBank } from './bank';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live')) throw new Error('Usage: pnpm demo:core [--live]');
  let bank: DemoBank | undefined;
  let accountId: string | undefined;
  if (args.includes('--live')) {
    const env = new URL('../../../.env.local', import.meta.url);
    if (existsSync(env)) process.loadEnvFile(fileURLToPath(env));
    if (!process.env.NESSIE_API_KEY) throw new Error('LIVE_NESSIE_KEY_REQUIRED: --live needs NESSIE_API_KEY');
    // Optional integration from #21/#42. Do not duplicate its HTTP SDK or silently claim a fake is live.
    const source = new URL('../../../integrations/nessie/src/index.ts', import.meta.url);
    if (!existsSync(source)) throw new Error('LIVE_NESSIE_CLIENT_NOT_MERGED: merge https://github.com/azizu06/backrooms/pull/42 first; use pnpm demo:core for the labeled fake');
    const module = await import(source.href);
    const claims = new module.FileClaims(fileURLToPath(new URL('../../../.board/core-demo-nessie-claims', import.meta.url)));
    bank = new module.NessieClient({ apiKey: process.env.NESSIE_API_KEY, claims });
    accountId = process.env.NESSIE_ACCOUNT_ID;
    if (!accountId) accountId = (await module.seedNorthfield(bank, claims)).account._id;
    console.log('LIVE Nessie sandbox ONLY. Card, call, controller authenticator and external pre-call checks remain simulated.');
  }
  console.log('MOMENT 1 | 3D closed | policy + gateway + StateStore real; all external services fake by default');
  const run = await runCoreDemo({ bank, accountId, ...(bank && { bankLabel: 'live_nessie_sandbox' }) });
  for (const line of run.transcript) console.log(line);
  console.log(`AUDIT chain valid=${run.chainValid}; gateway IDs retained in refs; why IDs audit_N alias audit:N`);
  for (const entry of run.entries) console.log(JSON.stringify(entry));
  for (const [index, answer] of run.answers.entries()) console.log(`ASK WHY ${index + 1} (${answer.source}): ${answer.answer}`);
  for (const llmOff of [false, true]) {
    const trap = await runInboxTrap({ llmOff });
    console.log(`MOMENT 2 | LLM ${llmOff ? 'OFF' : 'ON (no model needed)'} | #4471 lookalike + bank-change hold`);
    console.log(JSON.stringify(trap));
    if (!trap.chainValid) throw new Error('CORE_DEMO: invalid trap audit chain');
  }
  const ap = await runNorthfieldPayables();
  console.log('NORTHFIELD AP | ' + JSON.stringify(ap));
  if (!run.chainValid) throw new Error('CORE_DEMO: invalid collection audit chain');
  console.log('PASS: core loop, both bank-change traps, LLM OFF and audit chains. Synthetic run; phone/human-passkey/T4 live gates remain separate.');
}
main().catch(error => {
  // Never dump upstream exceptions, fetch URLs, request bodies or keys.
  const message = error instanceof Error && /^(CORE_DEMO:|LIVE_NESSIE_|Usage:)/.test(error.message)
    ? error.message : 'Core demo failed at an adapter boundary; check service setup (provider details withheld).';
  console.error(message); process.exitCode = 1;
});
