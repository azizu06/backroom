export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.BACKROOM_PAYMENT_DEMO === '1') {
    const { installPaymentDemo } = await import('./lib/payments/testing/demo');
    await installPaymentDemo();
  }
  // Opt-in local rehearsal only. Production starts empty and needs trusted call ingress.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.BACKROOM_APPROVAL_DEMO === '1') {
    const { installGatewayStore } = await import('./lib/gateway/runtime');
    const { MemoryGatewayStore } = await import('./lib/gateway/store');
    const { approvalDemoCall } = await import('./lib/approvals/testing/call');
    installGatewayStore(new MemoryGatewayStore([approvalDemoCall()]));
  }
}
