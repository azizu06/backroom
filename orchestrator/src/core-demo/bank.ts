import { northfield } from '../payables';
import { NessieClient, type Transaction } from '@backroom/nessie';
import type { PaymentBank } from '../payments';
export type DemoBank = PaymentBank;
/** SIMULATED transport exercising the real Nessie SDK. Never evidence for a live bank gate. */
export class FakeDemoBank extends NessieClient {
  constructor() {
    const deposits: Transaction[] = [];
    const claims = new Set<string>();
    super({ apiKey: 'fake-demo-no-network', claims: { async claim(key) {
      if (claims.has(key)) return false; claims.add(key); return true;
    } }, fetch: async (url, init) => {
      if (init?.method === 'POST') {
        const row = { ...JSON.parse(String(init.body)), _id: `fake-deposit-${deposits.length + 1}` };
        deposits.push(row); return Response.json({ objectCreated: row });
      }
      return Response.json(String(url).includes('/deposits') ? deposits : { balance: northfield.bankAccounts.find(row => row.id === 'receivables')!.balanceCents / 100 });
    } });
  }
}
