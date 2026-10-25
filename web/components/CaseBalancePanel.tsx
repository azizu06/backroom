'use client';
import { useEffect, useState } from 'react';
import type { CaseBalance } from '../lib/audit/balance';
import PlanBalance from './PlanBalance';

/** Operator-only case summary from the audit chain (`/api/audit/balance`). Renders nothing until signed in and a plan exists. */
export default function CaseBalancePanel({ intervalMs = 3000 }: { intervalMs?: number }) {
  const [balance, setBalance] = useState<CaseBalance | null>(null);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/audit/balance', { cache: 'no-store', signal: controller.signal });
        const body = response.ok ? await response.json() : { balance: null };
        if (!stopped) setBalance(body.balance ?? null);
      } catch { /* Keep the last reading; the next poll retries. */ }
    };
    void poll(); const timer = setInterval(() => void poll(), intervalMs);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [intervalMs]);
  if (!balance) return null;
  return <section aria-labelledby="case-balance" style={{ marginTop: 24 }}>
    <h2 id="case-balance">Invoice {balance.invoiceId} balance</h2>
    <PlanBalance balance={balance} label={`Invoice ${balance.invoiceId} payment plan`} />
  </section>;
}
