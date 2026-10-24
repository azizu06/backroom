'use client';

import { useState } from 'react';

/** The controller owns authenticated transport and refreshes llmEnabled from state.
 * Keep the server's bearer secret out of client props and NEXT_PUBLIC variables.
 */
export function LlmToggle({ llmEnabled, onToggle }: {
  llmEnabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try { await onToggle(!llmEnabled); }
    catch { setError('Could not change model state. Try again.'); }
    finally { setPending(false); }
  }
  return <span>
    <button type="button" role="switch" aria-label="Enable language models" aria-checked={llmEnabled}
      disabled={pending} onClick={toggle}>
      {pending ? 'Updating…' : llmEnabled ? 'LLM ON' : 'LLM OFF'}
    </button>
    {error && <span role="alert">{error}</span>}
  </span>;
}
