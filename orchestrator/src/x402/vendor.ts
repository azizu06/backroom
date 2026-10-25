import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'node:http';
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { X402_FACILITATOR, X402_LABEL, X402_NETWORK, X402_USDC, type X402Label } from './index';
import { facilitatorReason, type FacilitatorDiagnostic } from './diagnostics';

export interface VendorInvoice { id: string; amountCents: number; payTo: `0x${string}` }
/** Demo vendor, separate from the office/UI. Catalog and recipient are bootstrap-owned. */
export async function startTestnetVendor(invoice: VendorInvoice, options: { port?: number; facilitator?: FacilitatorClient; label?: X402Label;
  onFacilitatorResult?: (event: FacilitatorDiagnostic) => void; maxTimeoutSeconds?: 60 | 600 } = {}) {
  // A simulated label is only honest with an injected in-process facilitator.
  if (options.label && options.label !== X402_LABEL && !options.facilitator) throw new Error('X402_SIMULATION_NEEDS_MOCKS');
  const label = options.label ?? X402_LABEL;
  if (!Number.isSafeInteger(invoice.amountCents) || invoice.amountCents <= 0 || invoice.amountCents > 200_000 ||
      !/^0x[0-9a-fA-F]{40}$/.test(invoice.payTo)) throw new Error('X402_INVALID_VENDOR_INVOICE');
  const upstream = options.facilitator ?? new HTTPFacilitatorClient({ url: X402_FACILITATOR });
  const observed: FacilitatorClient = {
    getSupported: () => upstream.getSupported(),
    verify: async (...args) => {
      const result = await upstream.verify(...args);
      options.onFacilitatorResult?.({ stage: 'verify', success: result.isValid, reason: facilitatorReason(result.invalidReason) });
      return result;
    },
    settle: async (...args) => {
      const result = await upstream.settle(...args);
      options.onFacilitatorResult?.({ stage: 'settle', success: result.success, reason: facilitatorReason(result.errorReason) });
      return result;
    },
  };
  const protocol = new x402ResourceServer(observed)
    .register(X402_NETWORK, new ExactEvmScheme());
  await protocol.initialize();
  const requirements = (await protocol.buildPaymentRequirements({ scheme: 'exact', network: X402_NETWORK,
    payTo: invoice.payTo, price: { asset: X402_USDC, amount: String(BigInt(invoice.amountCents) * 10_000n),
      extra: { name: 'USDC', version: '2' } }, maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60 }))[0]!;
  let attempted = false;
  let active = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    const body = { label, vendor: 'Acme Supply', invoiceId: invoice.id, amountCents: invoice.amountCents, network: X402_NETWORK };
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.method !== 'GET' || req.url !== `/invoices/${encodeURIComponent(invoice.id)}`) return reply(404, { label, error: 'Unknown invoice' });
    const signature = req.headers['payment-signature'];
    try {
      if (!signature) {
        const required = await protocol.createPaymentRequiredResponse([requirements], {
          url: `${origin}/invoices/${encodeURIComponent(invoice.id)}`, description: `${label}: Acme Supply vendor invoice`, mimeType: 'application/json',
        });
        res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(required));
        return reply(402, { ...body, ...required });
      }
      if (typeof signature !== 'string' || signature.length > 16_000) return reply(400, { label, error: 'Invalid payment' });
      const payload = decodePaymentSignatureHeader(signature);
      if (payload.x402Version !== 2 || !isDeepStrictEqual(payload.accepted, requirements)) return reply(400, { label, error: 'Invoice terms differ' });
      // Once settlement was attempted, never accept a fresh authorization for this invoice.
      if (active || attempted) return reply(409, { label, error: 'Already attempted; reconcile original payment' });
      active = true;
      try {
        const verified = await protocol.verifyPayment(payload, requirements);
        if (!verified.isValid) return reply(402, { label, error: 'Payment verification failed' });
        attempted = true;
        const settlement = await protocol.settlePayment(payload, requirements);
        res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
        return reply(settlement.success ? 200 : 402, { ...body, transaction: settlement.transaction });
      } finally { active = false; }
    } catch { return reply(503, { label, error: 'Payment held; reconcile before retrying' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 4027, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('X402_VENDOR_LISTEN_FAILED');
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
