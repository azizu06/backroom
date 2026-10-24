import { expect, it, vi } from 'vitest';
import { createRouter } from './index';
import { invoiceSchema } from '../payables/schemas';
import { northfieldInvoice } from '../payables/northfield';
const input = { pages: [{ mediaType: 'image/png', data: 'aW1hZ2U=' }], context: '' };
const reply = (output: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify({ output, confidence: 0.99 }) } }], usage: { cost: 0 } });
it('extracts image content with the dedicated local vision model', async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(reply(northfieldInvoice('4401')));
  const result = await createRouter({ fetch: http }).route('document_extraction', input, invoiceSchema);
  expect(result).toMatchObject({ route: 'local', model: 'qwen2.5vl:7b', output: northfieldInvoice('4401') });
  const body = JSON.parse(String(http.mock.calls[0]![1]!.body));
  expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } });
});
it('requires two invalid local envelopes before sending images to Anthropic', async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ approved: true })).mockResolvedValueOnce(reply({}))
    .mockResolvedValueOnce(Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ output: northfieldInvoice('4401'), confidence: 0.99 }) }], usage: { input_tokens: 100, output_tokens: 100 } }));
  const result = await createRouter({ fetch: http, anthropicApiKey: 'synthetic', cloudProvider: 'anthropic' }).route('document_extraction', input, invoiceSchema);
  expect(result.route).toBe('cloud_fallback');
  expect(http.mock.calls.map(call => String(call[0]))).toEqual(['http://100.117.44.20:11434/v1/chat/completions', 'http://100.117.44.20:11434/v1/chat/completions', 'https://api.anthropic.com/v1/messages']);
  const body = JSON.parse(String(http.mock.calls[2]![1]!.body));
  expect(body.messages[0].content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } });
});
it('holds documents on transport failure or local-disabled mode without leaking images to cloud', async () => {
  const http = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  await expect(createRouter({ fetch: http }).route('document_extraction', input, invoiceSchema)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
  http.mockClear();
  await expect(createRouter({ fetch: http, localEnabled: false }).route('document_extraction', input, invoiceSchema)).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
});
it('keeps low-confidence documents held instead of sending them straight to cloud', async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ output: northfieldInvoice('4401'), confidence: .2 }) } }] }));
  await expect(createRouter({ fetch: http }).route('document_extraction', input, invoiceSchema)).rejects.toThrow('confidence');
  expect(http).toHaveBeenCalledTimes(1);
});
it('does not let slow text-model health bypass either local vision schema attempt', async () => {
  let now = 0;
  const http = vi.fn<typeof fetch>().mockImplementation(async () => { now += 6000; return reply(northfieldInvoice('4401')); });
  const router = createRouter({ fetch: http, now: () => now, cloudProvider: 'openrouter', cloudApiKey: 'synthetic' });
  await router.route('field_extraction', {}, invoiceSchema);
  expect(router.health().localAvailable).toBe(false);
  http.mockResolvedValueOnce(reply({ approved: true })).mockResolvedValueOnce(reply({}));
  expect((await router.route('document_extraction', input, invoiceSchema)).route).toBe('cloud_fallback');
  expect(http.mock.calls.slice(1, 3).every(call => String(call[0]).includes('100.117.44.20'))).toBe(true);
});
