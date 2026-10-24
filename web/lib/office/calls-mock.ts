import type { CallEvent } from './calls';

/** Scripted callback used only by the explicit `?calls=mock` preview. */
export function createMockCallFeed(emit: (event: CallEvent) => void, speed = 1): () => void {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  let cycle = 0;
  const schedule = (fn: () => void, ms: number, minimum = 600) => { timers.push(setTimeout(fn, Math.max(minimum, ms / speed))); };
  const run = () => {
    if (stopped) return;
    const id = `mock-call-${++cycle}`;
    const agent = { agentId: 'collections', agentName: 'Collections' };
    const send = (type: CallEvent) => { if (!stopped) emit(type); };
    send({ type: 'ring', callId: id, direction: 'inbound', ...agent, callerLabel: 'Callback · Northfield client', at: Date.now() });
    schedule(() => {
      send({ type: 'answer', callId: id, at: Date.now() });
      const lines = [
        ['agent', "Thanks for calling back. This is Backroom's automated collections assistant. I'm an AI, and this call is recorded."],
        ['caller', 'Hello, I am returning your call about the invoice.'],
        ['agent', 'Thank you. I can help with the outstanding balance on your account.'],
        ['caller', 'Can you tell me which invoice this is about?'],
        ['agent', 'It is invoice 1042. I can send the details by email.'],
      ] as const;
      const speakLine = (index: number) => {
        if (index === lines.length) {
          schedule(() => {
            send({ type: 'end', callId: id, reason: 'Call complete', at: Date.now() });
            schedule(() => { send({ type: 'clear' }); timers = []; schedule(run, 4000, 2500); }, 4000, 2500);
          }, 3000);
          return;
        }
        const [speaker, text] = lines[index]!;
        schedule(() => {
          send({ type: 'line', callId: id, line: { id: `${id}-line-${index}`, speaker,
            ...(speaker === 'agent' ? { agentId: 'collections' } : {}), text, at: Date.now() } });
          speakLine(index + 1);
        }, 700);
      };
      speakLine(0);
    }, 3000);
  };
  run();
  return () => { stopped = true; timers.forEach(clearTimeout); timers = []; };
}
