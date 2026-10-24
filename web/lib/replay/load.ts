import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseReplay, type ReplayRecording } from '@backroom/orchestrator/replay';

/** Only reviewed synthetic fixtures committed with the application are public.
 * No upload, arbitrary path, user-run recording directory or StateStore restore endpoint.
 */
export async function loadReplay(name: string): Promise<ReplayRecording | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return;
  try {
    const content = await readFile(resolve(process.cwd(), '../fixtures/replays', `${name}.jsonl`), 'utf8');
    const recording = parseReplay(content);
    if (recording.header.name !== name) return;
    return recording;
  } catch { return; }
}
