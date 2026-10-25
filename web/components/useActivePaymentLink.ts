'use client';
import { useEffect, useState } from 'react';
import { isReplayPage } from '../lib/replay/mode';

/** `/api/pay/active` projection: the call's authorized payment link. Read-only; carries no payment authority. */
export type ActivePaymentLink = { code: string; url: string; amountCents: number; expiresAt: number; qr: string; localOnly?: boolean; bankLine?: string };

/** Polls the active payment link. `link` is null when none is live or expired; `error` is true while the projection is unreachable. */
export function useActivePaymentLink({ enabled = true, intervalMs = 2000 }: { enabled?: boolean; intervalMs?: number } = {}) {
  const [delivery, setDelivery] = useState<ActivePaymentLink | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled || isReplayPage()) return;
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/pay/active', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const body = await response.json();
        if (!stopped) { setDelivery(body.active); setError(false); }
      } catch { if (!stopped) { setDelivery(null); setError(true); } }
    };
    void poll(); const timer = setInterval(() => void poll(), intervalMs);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [enabled, intervalMs]);
  return { link: delivery && delivery.expiresAt > Date.now() ? delivery : null, error };
}

export const formatUsd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
