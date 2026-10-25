import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReplay, type ReplayRecording } from '@backroom/orchestrator/replay';
import { operatorRoot } from '../operator/control';

/** Only reviewed synthetic fixtures committed with the application are public.
 * No upload, arbitrary path, user-run recording directory or StateStore restore endpoint.
 */
export async function loadReplay(name: string): Promise<ReplayRecording | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return;
  // The demo host starts from the repo root, `next dev` from web/: resolve like the operator control.
  const file = join(operatorRoot(), 'fixtures/replays', `${name}.jsonl`);
  let content: string;
  try { content = await readFile(file, 'utf8'); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.warn(`${code === 'ENOENT' ? 'REPLAY_MISSING' : `REPLAY_UNREADABLE ${code}`} ${name} ${file}`);
    return;
  }
  try {
    const recording = parseReplay(content);
    if (recording.header.name === name) return recording;
  } catch {}
  console.warn(`REPLAY_INVALID ${name} ${file}`);
}
