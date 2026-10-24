/** Opt-in live scenario smoke: real GX10 + Claude, synthetic inputs only. */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRouter, type TaskType } from './index.js';
const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.OPENROUTER_API_KEY) {
  console.log('SKIP live smoke: OPENROUTER_API_KEY is absent; run openrouter-env at the repo root.');
  process.exit(0);
}
const router = createRouter({localEnabled:true});
const scenarios: {task:TaskType; input:unknown}[] = [
  {task:'inbox_classification',input:{instruction:'Return {seat:string}, seat ap/ar/controller.',subject:'Vendor invoice received'}},
  {task:'inbox_classification',input:{instruction:'Return {seat:string}, seat ap/ar/controller.',subject:'Customer remittance advice received'}},
  {task:'field_extraction',input:{instruction:'Extract {invoiceId:string,total:number}.',invoice:'Invoice INV-1; total USD 42.50'}},
  {task:'field_extraction',input:{instruction:'Extract {purchaseOrder:string}.',email:'Please match this invoice to PO-88-19.'}},
  {task:'reconciliation_candidates',input:{instruction:'Suggest {candidates:string[]} only; do not decide or execute.',invoice:{vendor:'Paper LLC',total:42.5},purchaseOrders:[{id:'PO-1',vendor:'Paper LLC',total:42.5}]}},
  {task:'post_call_summary',input:{instruction:'Return {summary:string}.',notes:'Business customer requested invoice copy; no payment commitment.'}},
  {task:'post_call_summary',input:{instruction:'Return {summary:string}.',notes:'Customer requested a callback next week; no approval given.'}},
  {task:'call_plan',input:{instruction:'Return {plan:string}. Plan a short B2B call; disclose AI, verify identity before amount.',client:{type:'b2b',consent:true,identityVerified:false},invoice:{id:'INV-1',total:42.5}}},
  {task:'ask_why',input:{instruction:'Return {explanation:string}. Explain the supplied deterministic policy result; do not override it.',result:{action:'hold',ruleIds:['human-approval-required'],reason:'No passkey approval recorded'}}},
  {task:'ambiguous_judgment',input:{instruction:'Return {narrative:string}. Explain ambiguity and request human review.',evidence:{purchaseOrderTotal:42.5,invoiceTotal:45.5,approvalRecorded:false}}},
];
const schema = {
  parse(value:unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length===0) throw new Error('Expected nonempty task output object');
    return value;
  },
};
const entries = [];
const receiptUrl = new URL('../../../fixtures/t10/router-smoke.json',import.meta.url);
try {
  for (const [index, scenario] of scenarios.entries()) {
    const result=await router.route(scenario.task,scenario.input,schema);
    const entry={phase:'scenario',index,task:scenario.task,...result};
    entries.push(entry); console.log(JSON.stringify(entry));
  }
  // Break this client only; never stop or mutate the team's shared GPU server.
  router.setLocalBaseUrl('http://127.0.0.1:1/v1');
  const result=await router.route('inbox_classification',scenarios[0]!.input,schema);
  entries.push({phase:'link_killed',index:10,task:'inbox_classification',...result});
  console.log(JSON.stringify(entries.at(-1)));
  if (result.route!=='cloud_fallback') throw new Error('Expected cloud_fallback within one call');
  const localCalls=entries.filter(entry=>entry.route==='local').length;
  const receipt={measuredAt:new Date().toISOString(),entries,summary:{localCalls,totalCalls:entries.length,localShare:localCalls/entries.length,costUsd:entries.reduce((total,entry)=>total+entry.costUsd,0)},healthAfterKill:router.health()};
  await writeFile(receiptUrl,JSON.stringify({status:'passed',...receipt},null,2)+'\n');
  console.log(JSON.stringify(receipt.summary));
} catch (error) {
  const failure=error instanceof Error ? error.message : 'Live smoke failed';
  await writeFile(receiptUrl,JSON.stringify({status:'incomplete',measuredAt:new Date().toISOString(),entries,error:failure,health:router.health(),note:'Successful live Claude fallback is not verified. Network-free tests cover same-call fallback.'},null,2)+'\n');
  console.error(failure); process.exitCode=1;
} finally { router.stop(); }
