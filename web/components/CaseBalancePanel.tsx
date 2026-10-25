'use client';
import { useEffect, useState } from 'react';
import type { CaseBalance } from '../lib/audit/balance';
import { readCaseBalance } from '../lib/audit/balance-client';
import PlanBalance from './PlanBalance';

/** Operator-only case summary; signed-out visitors see the deliberate access gate. */
export default function CaseBalancePanel({ intervalMs = 3000 }: { intervalMs?: number }) {
  const [balance, setBalance] = useState<CaseBalance | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await readCaseBalance(controller.signal);
        if (!stopped) { setBalance(result.balance); setSignedIn(result.signedIn); }
      } catch { /* Keep the last reading; the next poll retries. */ }
      finally { if (!stopped) timer = setTimeout(() => void poll(), intervalMs); }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [intervalMs]);
  if (signedIn === false) return <p style={{ marginTop: 24 }}>Sign in as operator to see the invoice balance</p>;
  if (!balance) return null;
  return <section aria-labelledby="case-balance" style={{ marginTop: 24 }}>
    <h2 id="case-balance">Invoice {balance.invoiceId} balance</h2>
    <PlanBalance balance={balance} label={`Invoice ${balance.invoiceId} payment plan`} />
  </section>;
}
