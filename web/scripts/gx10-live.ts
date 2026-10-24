/** Opt-in, read-only GX10 check. No model request, SSH, or credentials. */
import { createGx10Reader } from '../lib/gx10/status';

async function main() {
  if (process.env.LIVE_GX10 !== '1') throw new Error('Opt in with LIVE_GX10=1');
  const read = createGx10Reader({ telemetry: () => null });
  const status = await read();
  console.log(JSON.stringify(status, null, 2));
  if (!status.reachable) process.exitCode = 1;
}
void main();
