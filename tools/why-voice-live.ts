/** Opt-in paid Cartesia smoke: one generated question + five local HTTP round trips. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { MemoryStateStore } from '../orchestrator/src/index';
import { createCartesia } from '../web/lib/why-voice/cartesia';
import { createWhyHTTP } from '../web/lib/why-voice/http';
import type { AskWhyVoiceResult } from '../web/lib/why-voice/types';

async function main() {
  if (process.env.WHY_VOICE_LIVE !== '1') throw new Error('Set WHY_VOICE_LIVE=1 to allow paid Cartesia requests.');
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error('CARTESIA_API_KEY is required.');
  // Isolate this smoke from the failing OpenRouter account; no fabricated model success.
  process.env.OPENROUTER_API_KEY = '';
  const state = new MemoryStateStore();
  await state.appendAudit({ id: '212', ts: 1, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'DENY',
    ruleIds: ['DUPLICATE_INVOICE'], policyVersion: 1, refs: ['4419', '4402'], route: 'code', latencyMs: 0, costUsd: 0,
    inputs: { invoiceId: '4419', relatedInvoiceId: '4402', amountDelta: 37 } });
  const cartesia = createCartesia(apiKey);
  let clip: Blob;
  if (process.env.WHY_VOICE_CLIP) {
    clip = new Blob([await readFile(process.env.WHY_VOICE_CLIP)], { type: process.env.WHY_VOICE_CLIP_TYPE ?? 'audio/wav' });
  } else {
    const question = await cartesia.speak('Why did you hold invoice 4419?', AbortSignal.timeout(30_000));
    clip = new Blob([Buffer.from(question.base64, 'base64')], { type: 'audio/wav' });
  }
  let origin = '';
  const handle = createWhyHTTP({ state: () => state, origin: () => origin });
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024 + 65536) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const response = await handle(new Request(`${origin}/api/why/voice`, {
        method: 'POST', headers: { origin, 'Content-Type': req.headers['content-type'] ?? '' }, body: Buffer.concat(chunks),
      }), 'voice');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end('LOCAL_SMOKE_FAILED'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('LOCAL_SERVER_FAILED');
  origin = `http://127.0.0.1:${address.port}`;
  try {
    const runs = [];
    for (let run = 1; run <= 5; run++) {
      const body = new FormData();
      body.set('audio', clip, 'question');
      const start = performance.now();
      const response = await fetch(`${origin}/api/why/voice`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) });
      const result = await response.json() as AskWhyVoiceResult & { error?: string };
      const endToEndMs = Math.round(performance.now() - start);
      if (!response.ok || !result.audio || result.audioError || !result.citations?.includes('212')) {
        throw new Error(`Run ${run} failed: ${result.error ?? result.audioError ?? 'MISSING_CITATION_OR_AUDIO'}`);
      }
      const receipt = { run, endToEndMs, serverMs: result.latencyMs, source: result.source,
        citations: result.citations, audioBytes: Buffer.from(result.audio.base64, 'base64').length };
      runs.push(receipt);
      console.log(JSON.stringify(receipt));
    }
    const times = runs.map(run => run.endToEndMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ p50EndToEndMs: times[2], runs: runs.length,
      providers: 'live Cartesia ink-whisper + sonic-3; deterministic askWhy fallback',
      scope: 'local HTTP upload to complete WAV response; excludes recording, question generation and playback' }));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => {
  // All thrown messages here are bounded local codes; never emit provider bodies or keys.
  console.error(error instanceof Error && /^(Set WHY_|CARTESIA_API_KEY|Run \d failed: [A-Z_]+$)/.test(error.message)
    ? error.message : 'WHY_VOICE_LIVE_FAILED');
  process.exitCode = 1;
});
