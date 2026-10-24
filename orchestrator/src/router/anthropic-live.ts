/** Opt-in, synthetic fixtures only. No calls, payments, or state writes. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRouter, isLlmOff, type RouteResult } from './index.js';
import { askWhy, type WhyAuditEntry } from '../why/index.js';
import { anthropicCostUsd, type AnthropicMessage } from './anthropic.js';
import { MemoryStateStore } from '../store.js';

if (process.env.ROUTER_LIVE_ANTHROPIC !== '1') throw new Error('Opt in with ROUTER_LIVE_ANTHROPIC=1 (at most three billable requests).');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY in repo-root .env.local.');

const startedAt = new Date().toISOString();
const requests: { requestId: string | null; model: string; usage: unknown; status: number; costUsd: number }[] = [];
const results: Omit<RouteResult, 'output'>[] = [];
// Fixed model/rates, 4096 output tokens and <100KB input per request: reserve
// $0.25 per request conservatively. Three requests reserve $0.75, below $3.
const spendCapUsd = 3;
const reservePerRequestUsd = 0.25;
const network: typeof fetch = async (url, init) => {
  if (url !== 'https://api.anthropic.com/v1/messages') throw new Error('Smoke permits only direct Anthropic.');
  if (requests.length >= 3 || (requests.length + 1) * reservePerRequestUsd > spendCapUsd) throw new Error('Smoke spend cap reached.');
  if (Buffer.byteLength(String(init?.body), 'utf8') > 100_000) throw new Error('Smoke input too large for reserved budget.');
  const response = await fetch(url, init);
  const body = response.ok ? await response.clone().json() as AnthropicMessage : undefined;
  requests.push({ requestId: response.headers.get('request-id'), status: response.status, model: body?.model ?? 'unknown', usage: body?.usage, costUsd: body ? anthropicCostUsd(body) : 0 });
  return response;
};
const state = new MemoryStateStore();
const router = createRouter({ fetch: network, stateStore: state, localEnabled: false, cloudProvider: 'anthropic', anthropicModel: 'claude-sonnet-5-5', timeoutMs: 60_000 });
const modelRoute: typeof router.route = async (task, input, schema) => {
  const result = await router.route(task, input, schema);
  if (!isLlmOff(result)) {
    const { output: _output, ...metadata } = result;
    results.push(metadata);
  }
  return result;
};
let callPlan: unknown;
let why: unknown;
let passed = false;
try {
  callPlan = await modelRoute('call_plan', {
    business: 'Northfield Studio', client: 'Synthetic B2B Client', identityConfirmed: false,
    request: 'Plan a short, disclosed AI collections call. Verify identity before any amount. No fee waivers or approvals.',
  }, {
    jsonSchema: { type: 'object', required: ['opening', 'identityCheck', 'steps'], additionalProperties: false,
      properties: { opening: { type: 'string' }, identityCheck: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } } },
    parse(value: unknown) {
      const plan = value as { opening?: unknown; identityCheck?: unknown; steps?: unknown } | null;
      if (!plan || typeof plan.opening !== 'string' || typeof plan.identityCheck !== 'string' ||
          !Array.isArray(plan.steps) || !plan.steps.length || !plan.steps.every(step => typeof step === 'string')) throw new Error('Invalid live call plan');
      return plan;
    },
  });
  const entries = JSON.parse(await readFile(new URL('../../../fixtures/why/audit-log.json', import.meta.url), 'utf8')) as WhyAuditEntry[];
  const answerKey = JSON.parse(await readFile(new URL('../../../fixtures/why/answer-key.json', import.meta.url), 'utf8')) as { question: string; correctIds: string[] }[];
  const scenario = answerKey[0]!;
  const answer = await askWhy(scenario.question, entries, { modelRoute, stateStore: state });
  why = { question: scenario.question, ...answer };
  if (isLlmOff(callPlan as RouteResult) || answer.source !== 'model' || !answer.citations.some(id => scenario.correctIds.includes(id))) throw new Error('Live smoke did not produce model-grounded results');
  const totalCostUsd = requests.reduce((sum, request) => sum + request.costUsd, 0);
  if (totalCostUsd > spendCapUsd) throw new Error('Smoke exceeded spend cap');
  passed = true;
} finally {
  const totalCostUsd = requests.reduce((sum, request) => sum + request.costUsd, 0);
  const dir = new URL('../../../docs/evidence/anthropic/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const receipt = new URL(`live-${startedAt.replace(/[:.]/g, '-')}.json`, dir);
  await writeFile(receipt, JSON.stringify({ startedAt, passed, provider: 'anthropic', spendCapUsd,
    reservedMaximumUsd: 3 * reservePerRequestUsd, totalCostUsd, requests, results, callPlan, why }, null, 2) + '\n');
  console.log(JSON.stringify({ passed, requests: requests.length, totalCostUsd, receipt: receipt.pathname }));
}
