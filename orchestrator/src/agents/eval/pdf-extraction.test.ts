import { expect, it, vi } from 'vitest';
import { expectedFields, PDF_FIELDS, pdfInvoiceIds, runPdfExtraction, scoreFields } from './pdf-extraction';

it('scores only document-printed fields with cosmetic normalisation', () => {
  const expected = expectedFields('4402');
  expect(scoreFields({ ...expected, vendorName: 'ACME SUPPLY.', invoiceId: '#4402' }, expected)).toEqual({ correct: PDF_FIELDS.length, total: PDF_FIELDS.length, mismatches: [] });
  expect(scoreFields({ ...expected, amountCents: 120001 }, expected).mismatches).toEqual(['amountCents']);
  expect(scoreFields(undefined, expected).correct).toBe(0);
  expect(pdfInvoiceIds()).toHaveLength(83);
});

it('reads the real PDF text, calls only GX10, and refuses any cloud fallback', async () => {
  const hosts: string[] = [];
  let body: any;
  const http = vi.fn<typeof fetch>(async (url, init) => {
    hosts.push(new URL(String(url)).host);
    body = JSON.parse(String(init?.body));
    const expected = expectedFields('4402');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ output: expected, confidence: 0.9 }) } }] });
  });
  const run = await runPdfExtraction({ fetch: http, ids: ['4402'] });
  expect(run).toMatchObject({ model: 'gpt-oss:20b', items: 1, exactItems: 1, errors: 0 });
  expect(hosts).toEqual(['100.117.44.20:11434']);
  expect(body.model).toBe('gpt-oss:20b');
  expect(body.messages[1].content).toContain('TOTAL DUE USD 1,200.00');

  const low = await runPdfExtraction({ ids: ['4402'], fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: {}, confidence: 0.2 }) } }] }) });
  expect(low).toMatchObject({ errors: 1, fieldsCorrect: expect.any(Number) });
  expect(low.results[0]).toMatchObject({ error: 'NO_LOCAL_RESULT_CLOUD_REFUSED', route: null });
});
