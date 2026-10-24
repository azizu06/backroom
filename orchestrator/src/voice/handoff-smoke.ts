/** Paid opt-in: exactly one short line per role; no calls or resource provisioning. */
import { writeFile, mkdir } from 'node:fs/promises';
import { createHandoffHandler } from './handoff';
import { voices } from './voices';

if (process.env.CARTESIA_HANDOFF_LIVE !== 'yes') throw Error('Set CARTESIA_HANDOFF_LIVE=yes for seven paid TTS requests');
if (!process.env.CARTESIA_API_KEY) throw Error('CARTESIA_API_KEY required');
const secret = 'local-smoke-only';
const handler = createHandoffHandler({ secret: () => secret, characterBudget: 1000 });
let totalCharacters = 0;
const results: { role: string; characters: number; bytes: number }[] = [];
for (const role of Object.keys(voices) as (keyof typeof voices)[]) {
  const text = `${role.replaceAll('_', ' ')}: handoff ready.`;
  const response = await handler(new Request('http://localhost/api/handoff', { method: 'POST',
    headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ role, text }) }));
  if (!response.ok) throw Error(`Smoke ${role} HTTP ${response.status}; no automatic retry`);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (Buffer.from(audio.subarray(0, 4)).toString() !== 'RIFF') throw Error('Expected WAV audio');
  const characters = Array.from(text).length;
  totalCharacters += characters;
  results.push({ role, characters, bytes: audio.length });
}
const receipt = { at: new Date().toISOString(), totalCharacters, results };
await mkdir('.env.voice', { recursive: true, mode: 0o700 });
await writeFile('.env.voice/handoff-smoke.json', JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(JSON.stringify(receipt));
