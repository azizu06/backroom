import { expect, it, vi } from 'vitest';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { startTestnetVendor } from './vendor';
import { X402_NETWORK, X402_USDC } from './index';

it('serves a real 402 handshake, settles only once through the mocked facilitator, and rejects unknown invoices', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const facilitator = {
    getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: X402_NETWORK }], extensions: [], signers: {} })),
    verify: vi.fn(async () => ({ isValid: true, payer: account.address })),
    settle: vi.fn(async () => ({ success: true, transaction: `0x${'cd'.repeat(32)}`, network: X402_NETWORK, payer: account.address })),
  };
  const server = await startTestnetVendor({ id: 'acme-demo', amountCents: 123, payTo: account.address }, { port: 0, facilitator });
  try {
    const url = `${server.origin}/invoices/acme-demo`;
    expect((await fetch(`${server.origin}/invoices/unknown`)).status).toBe(404);
    const response = await fetch(url);
    expect(response.status).toBe(402);
    const payerClient = new x402Client().register(X402_NETWORK, new ExactEvmScheme(account));
    payerClient.setSpendControls({ maxAmountPerPayment: '$2000' });
    const client = new x402HTTPClient(payerClient);
    const required = client.getPaymentRequiredResponse(name => response.headers.get(name));
    expect(required.accepts[0]).toMatchObject({ asset: X402_USDC, amount: '1230000', network: X402_NETWORK });
    const payload = await client.createPaymentPayload(required);
    const headers = client.encodePaymentSignatureHeader(payload);
    const paid = await fetch(url, { headers });
    expect(paid.status).toBe(200);
    expect(client.getPaymentSettleResponse(name => paid.headers.get(name)).success).toBe(true);
    expect((await fetch(url, { headers })).status).toBe(409);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  } finally { await server.close(); }
});
