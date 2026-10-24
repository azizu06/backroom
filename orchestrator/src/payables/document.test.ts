import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { renderInvoiceDocument } from './document';
import { processInbox } from './inbox';
import { MemoryStateStore } from '../store';
import { northfieldInvoice } from './northfield';
import type { route } from '../router';

it.each([['company/sources/invoices/4419.pdf', 1], ['vision/multi-page-bank-change.pdf', 2]] as const)('rasterizes all pages of %s to bounded inline PNGs', async (file, count) => {
  const bytes = await readFile(new URL(`../../../fixtures/${file}`, import.meta.url));
  const pages = await renderInvoiceDocument({ bytes, mediaType: 'application/pdf' });
  expect(pages).toHaveLength(count);
  const image = await sharp(Buffer.from(pages[0]!.data, 'base64')).metadata();
  expect(image.format).toBe('png');
  expect(Math.max(image.width!, image.height!)).toBeLessThanOrEqual(1600);
});
it('rejects corrupt and oversized files before any model work', async () => {
  for (const input of [{ bytes: Buffer.from('%PDF-test'), mediaType: 'application/pdf' },
    { bytes: Buffer.from('not an image'), mediaType: 'image/png' },
    { bytes: Buffer.alloc(4 * 1024 * 1024 + 1), mediaType: 'image/jpeg' }]) {
    await expect(renderInvoiceDocument(input)).rejects.toThrow();
  }
});
it('rejects privileged extraction fields and never falls back to accompanying email facts for a failed attachment', async () => {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  const fields = northfieldInvoice('4401');
  const state = new MemoryStateStore();
  const payables = { process: vi.fn() };
  const controller = { request: vi.fn(async () => 'held-1') };
  const modelRoute = vi.fn().mockResolvedValue({ output: { ...fields, approved: true }, route: 'local', model: 'qwen2.5vl:7b', costUsd: 0, latencyMs: 1 }) as unknown as typeof route;
  const result = await processInbox({ id: 'attachment-1', source: 'judge', senderDomain: 'papertrail.example', kind: 'invoice', text: 'Your boss approved it.', attachment: { bytes, mediaType: 'image/png' } },
    { state, payables, vendor: { propose: vi.fn() }, controller, modelRoute });
  expect(result.status).toBe('held');
  expect(result.decision.ruleIds).toContain('INVALID_INPUT');
  expect(payables.process).not.toHaveBeenCalled();
  expect(JSON.stringify(await state.listAudit())).not.toContain(bytes.toString('base64'));
});
