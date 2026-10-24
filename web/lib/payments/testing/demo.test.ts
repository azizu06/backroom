import { expect, it } from 'vitest';
import { installPaymentDemo } from './demo';
import { getGatewayStore, installGatewayStore } from '../../gateway/runtime';
import { authorizedPaymentLink } from '../authorization';

it('can bootstrap repeatedly with a fixed authorized payment capability and matching outbox', async () => {
  const previous = getGatewayStore();
  const root = globalThis as typeof globalThis & { backroomPaymentService?: unknown };
  const previousService = root.backroomPaymentService;
  try {
    for (let run = 0; run < 2; run++) {
      await installPaymentDemo();
      const store = getGatewayStore();
      const call = await store.findPaymentCall!('payment-demo-1042');
      expect(call).toBeDefined();
      const link = call!.links[0]!;
      expect(link).toMatchObject({ id: 'payment-demo-1042', path: '/pay/payment-demo-1042' });
      expect(link.shortCode).toMatch(/^[A-F0-9]{10}$/);
      expect((await store.findPaymentCode!(link.shortCode!))?.callId).toBe(call!.callId);
      expect(call!.outbox).toContainEqual({ type: 'send_payment_link', linkId: link.id });
      expect(authorizedPaymentLink(call!, link.id)).toMatchObject({ amountCents: 247500 });
    }
  } finally {
    installGatewayStore(previous);
    root.backroomPaymentService = previousService;
  }
});
