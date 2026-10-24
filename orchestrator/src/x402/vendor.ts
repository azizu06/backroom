import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'node:http';
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { X402_FACILITATOR, X402_LABEL, X402_NETWORK, X402_USDC } from './index';

export interface VendorInvoice { id: string; amountCents: number; payTo: `0x${string}` }
/** Demo vendor, separate from the office/UI. Catalog and recipient are bootstrap-owned. */
export async function startTestnetVendor(invoice: VendorInvoice, options: { port?: number; facilitator?: FacilitatorClient } = {}) {
  if (!Number.isSafeInteger(invoice.amountCents) || invoice.amountCents <= 0 || invoice.amountCents > 200_000 ||
      !/^0x[0-9a-fA-F]{40}$/.test(invoice.payTo)) throw new Error('X402_INVALID_VENDOR_INVOICE');
  const protocol = new x402ResourceServer(options.facilitator ?? new HTTPFacilitatorClient({ url: X402_FACILITATOR }))
    .register(X402_NETWORK, new ExactEvmScheme());
  await protocol.initialize();
  const requirements = (await protocol.buildPaymentRequirements({ scheme: 'exact', network: X402_NETWORK,
    payTo: invoice.payTo, price: { asset: X402_USDC, amount: String(BigInt(invoice.amountCents) * 10_000n),
      extra: { name: 'USDC', version: '2' } }, maxTimeoutSeconds: 60 }))[0]!;
  let attempted = false;
  let active = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    const body = { label: X402_LABEL, vendor: 'Acme Supply (demo)', invoiceId: invoice.id, amountCents: invoice.amountCents, network: X402_NETWORK };
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.method !== 'GET' || req.url !== `/invoices/${encodeURIComponent(invoice.id)}`) return reply(404, { label: X402_LABEL, error: 'Unknown invoice' });
    const signature = req.headers['payment-signature'];
    try {
      if (!signature) {
        const required = await protocol.createPaymentRequiredResponse([requirements], {
          url: `${origin}/invoices/${encodeURIComponent(invoice.id)}`, description: `${X402_LABEL}: Acme Supply vendor invoice`, mimeType: 'application/json',
        });
        res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(required));
        return reply(402, { ...body, ...required });
      }
      if (typeof signature !== 'string' || signature.length > 16_000) return reply(400, { label: X402_LABEL, error: 'Invalid payment' });
      const payload = decodePaymentSignatureHeader(signature);
      if (payload.x402Version !== 2 || !isDeepStrictEqual(payload.accepted, requirements)) return reply(400, { label: X402_LABEL, error: 'Invoice terms differ' });
      // Once settlement was attempted, never accept a fresh authorization for this invoice.
      if (active || attempted) return reply(409, { label: X402_LABEL, error: 'Already attempted; reconcile original payment' });
      active = true;
      try {
        const verified = await protocol.verifyPayment(payload, requirements);
        if (!verified.isValid) return reply(402, { label: X402_LABEL, error: 'Payment verification failed' });
        attempted = true;
        const settlement = await protocol.settlePayment(payload, requirements);
        res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
        return reply(settlement.success ? 200 : 402, { ...body, transaction: settlement.transaction });
      } finally { active = false; }
    } catch { return reply(503, { label: X402_LABEL, error: 'Payment held; reconcile before retrying' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 4027, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('X402_VENDOR_LISTEN_FAILED');
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
