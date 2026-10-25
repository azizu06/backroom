import { createRouter, route, isLlmOff, type OutputSchema } from '../router';
import { ModelFailure, ROUTER_FAILURE_KINDS, type RouterFailureKind } from '../router/failure';
import type { CallPlanner, PlanningInput } from './types';

export interface CallPlannerOptions {
  cloudRoute?: typeof route;
  fallbackRoute?: typeof route;
  fallbackFetch?: typeof fetch;
  /** Model label used only in redacted diagnostics. */
  modelId?: string;
  /** Receives metadata only; provider messages, prompts, and credentials are never forwarded. */
  reportFailure?: (failure: CallPlannerFailureDiagnostic) => void;
}

export interface CallPlannerFailureDiagnostic {
  stage: 'cloud' | 'gx10_fallback' | 'planner';
  status?: number;
  errorType: string;
  /** Redaction-safe router failure category, e.g. 'confidence' for a low self-confidence cloud plan. */
  kind?: RouterFailureKind;
  code?: string;
  modelId: string;
  /** Cloud attempts made; present only when the planner retried. */
  attempts?: number;
}

const safeToken = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value) ? value : fallback;

/** Convert an arbitrary failure into metadata safe for logs and immutable audit rows. */
export function sanitizeCallPlannerFailure(error: unknown, stage: CallPlannerFailureDiagnostic['stage'], modelId: string): CallPlannerFailureDiagnostic {
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const status = row && typeof row.status === 'number' && Number.isInteger(row.status) && row.status >= 100 && row.status <= 599 ? row.status : undefined;
  const rawCode = row?.kind ?? row?.code;
  const kind = ROUTER_FAILURE_KINDS.find(known => known === row?.kind);
  return {
    stage,
    ...(status !== undefined && { status }),
    errorType: safeToken(error instanceof Error ? error.constructor.name : typeof error, 'UnknownError'),
    ...(kind && { kind }),
    ...(rawCode !== undefined && { code: safeToken(rawCode, 'UNKNOWN') }),
    modelId: safeToken(modelId, 'unknown'),
  };
}

export class CallPlannerUnavailableError extends Error {
  override readonly name = 'CallPlannerUnavailableError';
  constructor(readonly diagnostic: CallPlannerFailureDiagnostic) { super('Call planner unavailable'); }
}

/** Call-plan tasks are hard calls. The only downgrade is the authorized billing fallback. */
export function createCallPlanner(options: CallPlannerOptions = {}): CallPlanner {
  const cloudRoute = options.cloudRoute ?? route;
  const cloudProvider = process.env.LLM_CLOUD_PROVIDER ?? 'anthropic';
  const modelId = options.modelId ?? (cloudProvider === 'anthropic'
    ? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
    : process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5');
  const reportFailure = (failure: CallPlannerFailureDiagnostic) => {
    try {
      if (options.reportFailure) options.reportFailure(failure);
      else console.error('call planner unavailable', failure);
    } catch { /* Diagnostics must not change the safe failure path. */ }
  };
  const unavailable = (error: unknown, stage: CallPlannerFailureDiagnostic['stage'], failedModelId: string, attempts = 1) => {
    const diagnostic = { ...sanitizeCallPlannerFailure(error, stage, failedModelId), ...(attempts > 1 && { attempts }) };
    reportFailure(diagnostic);
    return new CallPlannerUnavailableError(diagnostic);
  };
  const gx10Fetch: typeof fetch = (url, init) => {
    const body = JSON.parse(String(init?.body));
    // The shared router's cloud transport omits local reasoning controls. Keep the
    // quality fallback inside its token budget and reinforce its required wrapper.
    body.reasoning_effort = 'low';
    body.messages[0].content += ' The top-level JSON must have output and confidence. Put the call plan inside output.';
    return (options.fallbackFetch ?? fetch)(url, { ...init, body: JSON.stringify(body) });
  };
  // Route through the shared router API, overriding its cloud transport only for this fallback.
  // Zero rates identify local inference honestly; this never changes global router settings.
  const fallbackRoute = options.fallbackRoute ?? createRouter({
    cloudBaseUrl: process.env.GX10_BASE_URL ?? 'http://100.117.44.20:11434/v1',
    cloudProvider: 'openrouter', cloudApiKey: 'ollama', cloudModel: 'gpt-oss:120b', localEnabled: false,
    cloudInputUsdPerMillion: 0, cloudOutputUsdPerMillion: 0, timeoutMs: 30_000,
    fetch: gx10Fetch,
  }).route;
  return {
    async draft(input: PlanningInput) {
      const start = performance.now();
      const envelope = input.envelope;
      const schema: OutputSchema<unknown> = {
        parse: value => value,
        jsonSchema: {
          type: 'object', additionalProperties: false, required: ['tone', 'offerOrder', 'plan'],
          description: 'Short internal call plan. No speech or prose fields. Prefer installments first only when preferPlanFirst is true; if unavailable offer payment in full.',
          properties: {
            tone: { enum: ['neutral', 'empathetic'] },
            offerOrder: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: envelope.maxInstallments === 1 ? ['pay_in_full'] : ['pay_in_full', 'installments'] } },
            plan: { type: 'object', additionalProperties: false,
              description: 'For pay_in_full alone use installments=1, firstPaymentPct=100, totalDays=0. Include installments in offerOrder iff installments>1.',
              required: ['installments', 'firstPaymentPct', 'totalDays', 'waiveFees', 'discountPct'],
              properties: {
                installments: { type: 'integer', minimum: 1, maximum: envelope.maxInstallments },
                firstPaymentPct: { type: 'number', minimum: envelope.minFirstPct, maximum: 100 },
                totalDays: { type: 'integer', minimum: 0, maximum: envelope.maxPlanDays },
                waiveFees: { enum: envelope.feesWaivable ? [true, false] : [false] },
                discountPct: { type: 'number', minimum: 0, maximum: envelope.maxDiscountPct },
              },
            },
          },
        },
      };
      let attempts = 0;
      // A low self-confidence plan (or another non-transport router error) gets one fresh cloud attempt.
      // Each attempt re-runs the router's OFF, confidence, usage and cost checks; HTTP failures never retry.
      const attemptCloud = async (): Promise<Awaited<ReturnType<typeof route>>> => {
        attempts++;
        try { return await cloudRoute('call_plan', input, schema); }
        catch (error) { if (attempts > 1 || error instanceof ModelFailure) throw error; return attemptCloud(); }
      };
      try { return await attemptCloud(); }
      catch (error) {
        const cloudFailure = sanitizeCallPlannerFailure(error, 'cloud', modelId);
        if (cloudFailure.status !== 402) throw unavailable(error, 'cloud', modelId, attempts);
        try {
          const result = await fallbackRoute('call_plan', input, schema);
          if (isLlmOff(result)) return result;
          return { ...result, route: 'gx10_fallback', latencyMs: performance.now() - start, costUsd: 0 };
        } catch (fallbackError) { throw unavailable(fallbackError, 'gx10_fallback', 'gpt-oss:120b'); }
      }
    },
  };
}
