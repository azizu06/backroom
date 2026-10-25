import { operatorSessionActive } from '../operator/sign-in-client';

/** Session reads are public 200s; never poll the protected workday endpoint anonymously. */
export function pollWorkday(intervalMs: number, onResponse: (response: Response | null) => Promise<void> | void, onError: () => void) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    try {
      const signedIn = await operatorSessionActive();
      if (!active) return;
      const response = signedIn ? await fetch('/api/operator/workday', { cache: 'no-store' }) : null;
      if (!active) return;
      // A rejected/expired session cannot generate an endless stream of protected requests.
      if (response?.status === 401 || response?.status === 403) active = false;
      await onResponse(response);
    } catch { if (active) onError(); }
    finally { if (active) timer = setTimeout(() => { void refresh(); }, intervalMs); }
  };
  void refresh();
  return () => { active = false; clearTimeout(timer); };
}
