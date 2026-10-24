import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DocumentInput } from '../router/document';
export interface InvoiceAttachment { mediaType: string; bytes: Uint8Array }
const MAX_BYTES = 4 * 1024 * 1024;
/** Local, bounded rasterization. PDFium runs in a disposable worker with a hard
 * deadline; no system PDF tools, external URLs or raw document retention.
 */
export async function renderInvoiceDocument(file: InvoiceAttachment): Promise<DocumentInput['pages']> {
  if (!file.bytes.length || file.bytes.length > MAX_BYTES) throw new Error('INVALID_DOCUMENT_SIZE');
  const raster = async (bytes: Uint8Array) => {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, pages: 1, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1) throw new Error('INVALID_IMAGE');
    return { mediaType: 'image/png' as const, data: (await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64') };
  };
  if (file.mediaType !== 'application/pdf') {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mediaType)) throw new Error('INVALID_MEDIA_TYPE');
    return [await raster(file.bytes)];
  }
  if (Buffer.from(file.bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('INVALID_PDF');
  const bitmaps = await new Promise<{ width: number; height: number; data: Uint8Array }[]>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        // Resolve inside the worker: bundlers rewrite parent require.resolve to a numeric module ID.
        const modulePath = require.resolve('@hyzyla/pdfium', { paths: workerData.paths });
        const { PDFiumLibrary } = require(modulePath);
        const library = await PDFiumLibrary.init();
        let doc;
        try {
          doc = await library.loadDocument(workerData.bytes);
          const count = doc.getPageCount();
          if (count < 1 || count > 4) throw new Error('INVALID_PDF_PAGES');
          const pages = [];
          for (const page of doc.pages()) {
            const { originalWidth: w, originalHeight: h } = page.getOriginalSize();
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error('INVALID_PAGE');
            const bitmap = await page.render({ scale: Math.min(1600 / w, 1600 / h), renderFormFields: true });
            pages.push({ width: bitmap.width, height: bitmap.height, data: bitmap.data });
            page.close();
          }
          parentPort.postMessage(pages);
        } finally { doc?.destroy(); library.destroy(); }
      })().catch(() => { parentPort.postMessage({ error: true }); });
    `, { eval: true, workerData: { paths: [process.cwd(), join(process.cwd(), 'orchestrator'), join(process.cwd(), '..', 'orchestrator')], bytes: file.bytes }, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    // Parser diagnostics must never leak document content into API logs.
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('PDF_RENDER_TIMEOUT')); }, 20000);
    worker.once('message', message => {
      clearTimeout(timer); void worker.terminate();
      if (!Array.isArray(message)) reject(new Error('INVALID_PDF'));
      else resolve(message);
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('PDF_RENDER_FAILED')); });
    worker.once('exit', () => { clearTimeout(timer); reject(new Error('PDF_RENDER_FAILED')); });
  });
  return await Promise.all(bitmaps.map(async image => ({ mediaType: 'image/png' as const,
    data: (await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer()).toString('base64') })));
}
