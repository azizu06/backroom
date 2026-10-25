/** What this host process saw the live Nessie sandbox do. Config or key presence is never proof. */
export type NessieProof = { kind: 'sandbox_read' | 'deposit_exact_match'; at: string; depositId?: string };
export type NessieEvidence = { proof?: NessieProof; unreachableAt?: string };

export function createNessieEvidence(now: () => number = Date.now) {
  let read: NessieProof | undefined, deposit: NessieProof | undefined, unreachableAt: string | undefined;
  const at = () => new Date(now()).toISOString();
  return {
    /** NessieClient `observe`: fires only after a 2xx response with a parsed JSON body. */
    observe(event: { method: string; status: number }) {
      if (event.method !== 'GET' || event.status < 200 || event.status > 299) return;
      read = { kind: 'sandbox_read', at: at() };
      unreachableAt = undefined;
    },
    /** Records a failed sandbox read; the client still receives the same response or error. */
    watch(http: typeof fetch): typeof fetch {
      return async (input, init) => {
        const get = (init?.method ?? 'GET').toUpperCase() === 'GET';
        try {
          const response = await http(input, init);
          if (get && !response.ok) unreachableAt = at();
          return response;
        } catch (error) {
          if (get) unreachableAt = at();
          throw error;
        }
      };
    },
    /** A sandbox deposit reconciled to its invoice receipt as EXACT_PAYMENT_MATCH. */
    depositMatched(depositId: string) { deposit = { kind: 'deposit_exact_match', at: at(), depositId }; },
    snapshot(): NessieEvidence {
      const proof = deposit ?? read;
      return { ...(proof ? { proof: { ...proof } } : {}), ...(unreachableAt ? { unreachableAt } : {}) };
    },
  };
}
