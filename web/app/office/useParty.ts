'use client';

import { useCallback, useEffect, useState } from 'react';
import { NO_PARTY, PARTY_ENDPOINT, parsePartyStatus, type PartyStatus } from '../../lib/office/party';

export interface PartyState { status: PartyStatus; busy: boolean; start(): void; stop(): void }
const HOST_POLL_MS = 3000;

async function request(path: string, init?: RequestInit): Promise<PartyStatus> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  // A refused start still reports the current status and an error code.
  return response.ok || response.status === 409 ? parsePartyStatus(await response.json()) : NO_PARTY;
}

/**
 * Asks the demo host who this page is: the host on its own machine, a view-only guest on the party
 * listener, or neither (`next dev`, a tunnel). The host polls while hosting for the guest count.
 */
export function useParty(enabled: boolean): PartyState {
  const [status, setStatus] = useState<PartyStatus>(NO_PARTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) { setStatus(NO_PARTY); return; }
    let stopped = false;
    void request(PARTY_ENDPOINT).then(next => { if (!stopped) setStatus(next); }, () => {});
    return () => { stopped = true; };
  }, [enabled]);
  const hosting = status.role === 'host' && !!status.hosting;
  useEffect(() => {
    if (!hosting) return;
    const timer = window.setInterval(() => { void request(PARTY_ENDPOINT).then(setStatus, () => {}); }, HOST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hosting]);
  const act = useCallback((action: 'start' | 'stop') => {
    setBusy(true);
    void request(`${PARTY_ENDPOINT}/${action}`, { method: 'POST' })
      .then(setStatus, () => setStatus(current => ({ ...current, error: 'PARTY_START_FAILED' })))
      .finally(() => setBusy(false));
  }, []);
  const start = useCallback(() => act('start'), [act]);
  const stop = useCallback(() => act('stop'), [act]);
  return { status, busy, start, stop };
}
