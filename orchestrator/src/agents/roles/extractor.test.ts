import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createExtractorSpecialist, type ExtractorDependencies } from './extractor';
import type { Activation, Json, ToolContext } from '../contracts';

const invoice = { kind: 'invoice', invoiceId: 'INV-42', vendorId: 'acme', poId: null,
  amountCents: 4250, currency: 'USD', bankAccountId: 'suspicious-document-account',
  lineItems: [{ description: 'Services', quantity: 1, unitPriceCents: 4250 }] };
function harness(overrides: Partial<ExtractorDependencies> = {}) {
  const activation: Activation = { caseId: 'case-1', taskId: 'task-1', activationId: 'activation-1', role: 'extractor',
    leaseOwner: 'server', leaseToken: 1, llmGeneration: 1, artifactRefs: ['case-1:document'], credentialOwnerId: 'owner', signal: new AbortController().signal };
  const ctx: ToolContext = { activation, assertCurrent: vi.fn(async () => { activation.signal.throwIfAborted(); }) };
  const saved: Json[] = [];
  const http = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: invoice, confidence: .95 }) } }] }));
  const deps: ExtractorDependencies = {
    readDocument: async () => ({ text: 'Invoice INV-42; Services USD 42.50; Acme; bank suspicious-document-account' }),
    saveExtraction: async (_ctx, artifact) => { saved.push(artifact); return 'case-1:extraction'; },
    fetch: http, ...overrides,
  };
  const specialist = createExtractorSpecialist(deps);
  const call = async (name: string, input: unknown, context = ctx) => {
    const tool = specialist.tools.find(tool => tool.name === name)!;
    return tool.execute(context, tool.input.parse(input));
  };
  return { specialist, call, ctx, saved, http };
}

describe('Extractor responsibility', () => {
  it('returns schema feedback, accepts a correction and saves bank details only as evidence', async () => {
    const h = harness();
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    await h.call('local_extract', { documentRef: 'case-1:document' });
    expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: { ...invoice, amountCents: 99 } }))
      .toMatchObject({ decision: 'DENY', errors: ['TOTAL_MISMATCH'], attemptsRemaining: 2 });
    expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice }))
      .toMatchObject({ decision: 'ALLOW', artifactRef: 'case-1:extraction', bankAccountUsage: 'evidence_only' });
    expect(h.saved).toEqual([{ kind: 'validated_extraction', documentRef: 'case-1:document', fields: invoice, bankAccountUsage: 'evidence_only' }]);
    expect(h.specialist.allowedNext).toEqual(['vendor', 'payables', 'intake']);
    expect(h.specialist.model).toBe('claude-haiku-5-5');
  });

  it('bounds schema correction at three attempts and never persists invalid data', async () => {
    const h = harness();
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    await h.call('local_extract', { documentRef: 'case-1:document' });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: { ...invoice, approved: true } }))
        .toMatchObject({ decision: attempt === 2 ? 'ESCALATE' : 'DENY', errors: ['INVALID_FIELDS'] });
    }
    expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice }))
      .toMatchObject({ decision: 'ESCALATE', errors: ['VALIDATION_ATTEMPTS_EXHAUSTED'] });
    expect(h.saved).toEqual([]);
  });

  it('uses the existing raster/inline-image vision path with a mocked GX10 provider', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const h = harness({ readDocument: async () => ({ text: '', attachment: { mediaType: 'image/png', bytes } }) });
    expect(await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 })).toMatchObject({ hasAttachment: true, text: '' });
    expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ model: 'qwen2.5vl:7b', fields: invoice });
    const [url, request] = h.http.mock.calls[0]!;
    expect(url).toBe('http://100.117.44.20:11434/v1/chat/completions');
    const body = JSON.parse(String(request!.body));
    expect(body.model).toBe('qwen2.5vl:7b');
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(request!.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer ollama' });
  });

  it('keeps text local on qwen3:8b and provides candidate fields without accepting them', async () => {
    const h = harness();
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ model: 'qwen3:8b', fields: invoice });
    expect(JSON.parse(String(h.http.mock.calls[0]![1]!.body))).toMatchObject({ model: 'qwen3:8b', reasoning_effort: 'none' });
    expect(h.saved).toEqual([]);
  });

  it('rejects foreign refs, authority fields and validation without local evidence', async () => {
    const h = harness();
    expect(await h.call('read_document', { documentRef: 'other-case:document', chunk: 0 })).toMatchObject({ decision: 'DENY' });
    expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ errors: ['READ_DOCUMENT_FIRST'] });
    expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice })).toMatchObject({ errors: ['LOCAL_EVIDENCE_REQUIRED'] });
    await expect(h.call('local_extract', { documentRef: 'case-1:document', role: 'payables', destinationAccountId: 'attacker' })).rejects.toThrow();
    const foreignRole: ToolContext = { ...h.ctx, activation: { ...h.ctx.activation, role: 'payables' } };
    expect(await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 }, foreignRole)).toMatchObject({ errors: ['WRONG_ROLE'] });
    expect(h.http).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
  });

  it('bounds local failures without a cloud fallback and routes low confidence to intake', async () => {
    const http = vi.fn<typeof fetch>(async () => Response.json({ choices: [] }));
    const h = harness({ fetch: http });
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    for (let i = 0; i < 3; i++) expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'DENY' });
    expect(await h.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'ESCALATE', next: 'intake' });
    expect(http).toHaveBeenCalledTimes(3);
    const low = harness({ fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: invoice, confidence: .1 }) } }] }) });
    await low.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    expect(await low.call('local_extract', { documentRef: 'case-1:document' })).toMatchObject({ decision: 'ESCALATE', errors: ['LOW_CONFIDENCE'] });
    expect(await low.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice })).toMatchObject({ decision: 'DENY' });
  });

  it('fences OFF/ON or stale lease results before returning local output', async () => {
    let stale = false;
    const h = harness({ fetch: async () => { stale = true; return Response.json({ choices: [{ message: { content: JSON.stringify({ output: invoice, confidence: .9 }) } }] }); } });
    h.ctx.assertCurrent = async () => { if (stale) throw new Error('STALE_GENERATION'); };
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    await expect(h.call('local_extract', { documentRef: 'case-1:document' })).rejects.toThrow('STALE_GENERATION');
    expect(h.saved).toEqual([]);
    const cancelled = harness();
    cancelled.ctx.activation.signal = AbortSignal.abort();
    await expect(cancelled.call('read_document', { documentRef: 'case-1:document', chunk: 0 })).rejects.toThrow();
    expect(cancelled.http).not.toHaveBeenCalled();
  });

  it('saves once for parallel validation calls and isolates a second activation', async () => {
    const h = harness();
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    await h.call('local_extract', { documentRef: 'case-1:document' });
    const [first, second] = await Promise.all([h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice }), h.call('validate_extraction', { documentRef: 'case-1:document', fields: invoice })]);
    expect(first).toMatchObject({ artifactRef: 'case-1:extraction' });
    expect(second).toMatchObject({ artifactRef: 'case-1:extraction' });
    expect(h.saved).toHaveLength(1);
    const other: ToolContext = { ...h.ctx, activation: { ...h.ctx.activation, activationId: 'activation-2', artifactRefs: ['case-2:document'], caseId: 'case-2' } };
    expect(await h.call('validate_extraction', { documentRef: 'case-2:document', fields: invoice }, other)).toMatchObject({ errors: ['LOCAL_EVIDENCE_REQUIRED'] });
  });

  it('validates vendor/bank-change evidence with the existing schema', async () => {
    const fields = { kind: 'bank_change', vendorId: 'acme', domain: 'acme.example', bankAccountId: 'new-unapproved-account' };
    const h = harness({ fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: fields, confidence: .9 }) } }] }) });
    await h.call('read_document', { documentRef: 'case-1:document', chunk: 0 });
    await h.call('local_extract', { documentRef: 'case-1:document' });
    expect(await h.call('validate_extraction', { documentRef: 'case-1:document', fields })).toMatchObject({ decision: 'ALLOW', fields, bankAccountUsage: 'evidence_only' });
    expect(h.specialist.tools.map(tool => tool.name)).toEqual(['read_document', 'local_extract', 'validate_extraction']);
  });
});
