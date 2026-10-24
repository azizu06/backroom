import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { createExtractorSpecialist, type ExtractorDependencies } from './extractor';
import { EXTRACTION_SCHEMA, type ExtractionRouter } from '../tools/local-extract';
import { createRouter } from '../../router';
import { MemoryStateStore } from '../../store';
import type { Activation, Json, ToolContext } from '../contracts';

const invoice = { kind: 'invoice', invoiceId: 'INV-42', vendorId: 'acme', poId: null,
  amountCents: 4250, currency: 'USD', bankAccountId: 'suspicious-document-account',
  lineItems: [{ description: 'Services', quantity: 1, unitPriceCents: 4250 }] };
const TEXT = 'Invoice INV-42; Services USD 42.50; Acme; bank suspicious-document-account';
const cut: typeof fetch = async () => { throw new TypeError('fetch failed'); };

function harness(overrides: Partial<ExtractorDependencies> = {}, signal = new AbortController().signal) {
  const activation: Activation = { caseId: 'case-1', taskId: 'task-1', activationId: 'activation-1', role: 'extractor',
    leaseOwner: 'server', leaseToken: 1, llmGeneration: 1, artifactRefs: ['case-1:document'], credentialOwnerId: 'owner', signal };
  const ctx: ToolContext = { activation, assertCurrent: vi.fn(async () => { activation.signal.throwIfAborted(); }) };
  const saved: Json[] = [];
  const audit = new MemoryStateStore();
  const deps: ExtractorDependencies = { readDocument: async () => ({ text: TEXT }),
    saveExtraction: async (_ctx, artifact) => { saved.push(artifact); return 'case-1:extraction'; }, fetch: cut, audit, ...overrides };
  const specialist = createExtractorSpecialist(deps);
  const call = async (name: string, input: unknown) => {
    const tool = specialist.tools.find(row => row.name === name)!;
    return tool.execute(ctx, tool.input.parse(input));
  };
  return { call, ctx, saved, audit };
}
/** The production router over a mocked transport: GX10 cut, Anthropic answers with a canned candidate. */
function productionRouter(candidate: unknown = invoice, gx10Recovered = false) {
  const requests: { url: string; body: any }[] = [];
  const router = createRouter({ stateStore: new MemoryStateStore(), anthropicApiKey: 'offline-test-key', anthropicModel: 'claude-sonnet-5-5',
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), body });
      if (!String(url).startsWith('https://api.anthropic.com/')) {
        if (gx10Recovered) return Response.json({ choices: [{ message: { content: JSON.stringify({ output: candidate, confidence: .9 }) } }] });
        throw new TypeError('fetch failed');
      }
      return Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ output: candidate, confidence: 0.9 }) }], usage: { input_tokens: 1200, output_tokens: 300 } });
    } });
  return { router: router as ExtractionRouter, requests };
}

it('falls back to Claude through the production router in one local_extract call, text and schema only', async () => {
  const { router, requests } = productionRouter();
  const h = harness({ router });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  const result = await h.call('local_extract', { documentRef: 'case-1:document' }) as Record<string, Json>;
  expect(result).toMatchObject({ decision: 'ALLOW', route: 'cloud_fallback', model: 'claude-sonnet-5-5', fields: invoice });
  expect(result.costUsd).toBeCloseTo((1200 * 2 + 300 * 10) / 1e6);
  const cloud = requests.filter(row => row.url.startsWith('https://api.anthropic.com/'));
  expect(cloud).toHaveLength(1);
  expect(requests).toHaveLength(1); // sustained outage: no second GX10 attempt before Claude
  expect(cloud[0]!.body.messages).toEqual([{ role: 'user', content: JSON.stringify(TEXT) }]);
  expect(cloud[0]!.body.system).toContain(JSON.stringify(EXTRACTION_SCHEMA.jsonSchema));
  expect(JSON.stringify(cloud[0]!.body)).not.toMatch(/case-1|activation-1|owner/);
  // The same validation gate applies to cloud output.
  expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: { ...invoice, approved: true } }))
    .toMatchObject({ decision: 'DENY', errors: ['INVALID_FIELDS'] });
  expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice })).toMatchObject({ decision: 'ALLOW' });
  expect(h.saved).toHaveLength(1);
  const rows = (await h.audit.listAudit()).filter(row => row.action === 'extraction_routed');
  expect(rows).toEqual([expect.objectContaining({ route: 'cloud_fallback', actor: 'claude', ruleIds: ['ROUTE_FALLBACK'],
    costUsd: result.costUsd, inputs: expect.objectContaining({ model: 'claude-sonnet-5-5' }) })]);
  expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
});

it('keeps the healthy GX10 path local and never calls the router', async () => {
  const route = vi.fn<ExtractionRouter['fallback']>();
  const h = harness({ router: { fallback: route }, fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: invoice, confidence: .95 }) } }] }) });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' }))
    .toMatchObject({ decision: 'ALLOW', route: 'local', model: 'qwen3:8b', confidence: .95, costUsd: 0 });
  expect(route).not.toHaveBeenCalled();
  expect((await h.audit.listAudit()).filter(row => row.action === 'extraction_routed'))
    .toEqual([expect.objectContaining({ route: 'local', actor: 'local_model', ruleIds: [], costUsd: 0 })]);
});

it('a bad local answer is not an outage: no fallback, the existing retry path stays', async () => {
  const route = vi.fn<ExtractionRouter['fallback']>();
  const h = harness({ router: { fallback: route }, fetch: async () => Response.json({ choices: [{ message: { content: 'not json' } }] }) });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'DENY', errors: ['LOCAL_EXTRACTION_FAILED'] });
  expect(route).not.toHaveBeenCalled();
});

it('never sends attachment bytes to the cloud: a scan with no text stays held', async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  const route = vi.fn<ExtractionRouter['fallback']>();
  const h = harness({ router: { fallback: route }, readDocument: async () => ({ text: '', attachment: { mediaType: 'image/png', bytes } }) });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'DENY', errors: ['LOCAL_EXTRACTION_FAILED'] });
  expect(route).not.toHaveBeenCalled();
});

it('sends only the context text, not the image, when a scanned document with text falls back', async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  const route = vi.fn<ExtractionRouter['fallback']>(async () => ({ output: invoice, route: 'cloud_fallback' as const, model: 'claude-sonnet-5-5', latencyMs: 5, costUsd: 0.001 }));
  const h = harness({ router: { fallback: route }, readDocument: async () => ({ text: TEXT, attachment: { mediaType: 'image/png', bytes } }) });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'ALLOW', route: 'cloud_fallback' });
  expect(route).toHaveBeenCalledWith('field_extraction', TEXT, EXTRACTION_SCHEMA);
});

it('the OFF switch and a lost activation still fence the fallback', async () => {
  const off = harness({ router: { fallback: async () => ({ kind: 'LLM_OFF' as const, route: 'code' as const, model: 'none' as const, latencyMs: 0 as const, costUsd: 0 as const }) } });
  await off.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await off.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'DENY', errors: ['LOCAL_EXTRACTION_FAILED'] });

  const controller = new AbortController();
  const { router } = productionRouter();
  const late = harness({ router: { fallback: async (...args) => { const out = await router.fallback(...args); controller.abort('STALE'); return out; } } }, controller.signal);
  await late.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  await expect(late.call('local_extract', { documentRef: 'case-1:document' })).rejects.toBe('STALE');
  expect(await late.audit.listAudit()).toEqual([]);
  expect(late.saved).toEqual([]);
});

it('a GX10 that recovers between calls is not retried inside the fallback: still exactly one Claude request', async () => {
  const { router, requests } = productionRouter(invoice, true);
  const h = harness({ router });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ route: 'cloud_fallback', model: 'claude-sonnet-5-5' });
  expect(requests.map(row => new URL(row.url).host)).toEqual(['api.anthropic.com']);
});

it.each([
  ['HTTP 503', async () => new Response('', { status: 503 })],
  ['a timeout', async (_url: unknown, init?: RequestInit) => { throw Object.assign(new DOMException('timed out', 'TimeoutError'), { init }); }],
])('falls back on %s', async (_name, http) => {
  const fallback = vi.fn<ExtractionRouter['fallback']>(async () => ({ output: invoice, route: 'cloud_fallback' as const, model: 'claude-sonnet-5-5', latencyMs: 1, costUsd: 0.001 }));
  const h = harness({ router: { fallback }, fetch: http as typeof fetch });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'ALLOW', route: 'cloud_fallback' });
  expect(fallback).toHaveBeenCalledTimes(1);
});

it.each([
  ['HTTP 400', { fetch: async () => new Response('bad request', { status: 400 }) }],
  ['an HTTP 200 null body', { fetch: async () => Response.json(null) }],
  ['an invalid attachment before any GX10 request', { readDocument: async () => ({ text: TEXT, attachment: { mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) } }) }],
] as const)('does not fall back on %s: the existing hold path stays', async (_name, overrides) => {
  const fallback = vi.fn<ExtractionRouter['fallback']>();
  const h = harness({ router: { fallback }, ...overrides } as Partial<ExtractorDependencies>);
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'DENY', errors: ['LOCAL_EXTRACTION_FAILED'] });
  expect(fallback).not.toHaveBeenCalled();
});

it('audits to the shared StateStore when a caller supplies no audit sink', async () => {
  const { getStateStore } = await import('../../runtime');
  const before = (await getStateStore().listAudit()).length;
  const fallback = vi.fn<ExtractionRouter['fallback']>(async () => ({ output: invoice, route: 'cloud_fallback' as const, model: 'claude-sonnet-5-5', latencyMs: 3, costUsd: 0.002 }));
  const h = harness({ router: { fallback }, audit: undefined });
  await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
  await h.call('local_extract', { documentRef: 'case-1:document' });
  const rows = (await getStateStore().listAudit()).slice(before).filter(row => row.action === 'extraction_routed');
  expect(rows).toEqual([expect.objectContaining({ route: 'cloud_fallback', ruleIds: ['ROUTE_FALLBACK'], costUsd: 0.002 })]);
});
