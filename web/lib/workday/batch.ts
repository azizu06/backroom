import { setTimeout as delay } from 'node:timers/promises';
import type { StateStore } from '@backroom/orchestrator';
import { CASE_BUDGET_USD, LEDGER_LIMITS, type UsageLedger } from '@backroom/orchestrator/agents';

export const WORKDAY_ITEMS = ['4401', '4481', '4482', 'bc-lookalike'] as const;
type Status = 'ready' | 'running' | 'done' | 'stopped';
/** A bounded producer for the existing inbox host, never a dispatcher or handoff store. */
export function createWorkdayBatch(options: {
  control: StateStore; ledger: UsageLedger; enabled: () => boolean;
  submit: (id: typeof WORKDAY_ITEMS[number]) => Promise<void>; drain: () => Promise<void>;
  wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
}) {
  let status: Status = 'ready', message = 'Three invoices and one bank-change attack. No payments.';
  let job = Promise.resolve();
  const abort = new AbortController();
  const view = (started = false) => ({ started, status, message });
  async function gate(remaining: number) {
    if (abort.signal.aborted || !options.control.llmEnabled || !options.enabled()) throw new Error('Agents are OFF or the company was reset. Turn agents ON before starting the workday.');
    const usage = await options.ledger.usage('aziz');
    if (usage.spentUsd + usage.reservedUsd + remaining * CASE_BUDGET_USD.demo > LEDGER_LIMITS.hardStopUsd) {
      throw new Error('The shared usage ledger is near its $40 stop. The workday needs room for the remaining demo case budgets.');
    }
  }
  async function start() {
    if (status !== 'ready') return { ...view(), message: `Workday already ${status}. ${message}` };
    status = 'running'; // Claim before the asynchronous gate: two presses cannot launch two batches.
    try { await gate(WORKDAY_ITEMS.length); }
    catch (error) { status = abort.signal.aborted ? 'stopped' : 'ready'; message = error instanceof Error ? error.message : 'Usage ledger unavailable; workday refused.'; return view(); }
    message = 'Workday running. Three invoices and a bank-change attack; no payments.';
    job = (async () => {
      try {
        for (const [index, id] of WORKDAY_ITEMS.entries()) {
          if (index) await (options.wait ?? ((ms, signal) => delay(ms, undefined, { signal })))(2500, abort.signal);
          await gate(WORKDAY_ITEMS.length - index);
          await options.submit(id); // Inbox returns after its decision; its real agents continue concurrently.
        }
        await options.drain();
        status = 'done'; message = 'Workday done. Review the live handoffs and held decisions; no payments were submitted.';
      } catch (error) {
        status = 'stopped'; message = error instanceof Error ? error.message : 'Workday stopped. Review recorded decisions before resetting.';
      }
    })();
    return view(true);
  }
  return { start, view, drain: () => job, async stop() { abort.abort(); await job; } };
}
