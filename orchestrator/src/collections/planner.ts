import { createRouter, route, isLlmOff, type OutputSchema } from '../router';
import type { CallPlanner, PlanningInput } from './types';

export interface CallPlannerOptions {
  cloudRoute?: typeof route;
  fallbackRoute?: typeof route;
  fallbackFetch?: typeof fetch;
}

/** Call-plan tasks are hard calls. The only downgrade is the authorized billing fallback. */
export function createCallPlanner(options: CallPlannerOptions = {}): CallPlanner {
  const cloudRoute = options.cloudRoute ?? route;
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
      try { return await cloudRoute('call_plan', input, schema); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'Model request failed: HTTP 402') throw new Error('Call planner unavailable');
        try {
          const result = await fallbackRoute('call_plan', input, schema);
          if (isLlmOff(result)) return result;
          return { ...result, route: 'gx10_fallback', latencyMs: performance.now() - start, costUsd: 0 };
        } catch { throw new Error('Call planner unavailable'); }
      }
    },
  };
}
