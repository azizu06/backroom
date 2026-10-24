import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeLiveBenchmark } from './inbox-benchmark';
if (process.env.INBOX_BENCHMARK_LIVE !== '1') {
  console.log('Skipped: set INBOX_BENCHMARK_LIVE=1; live GX10 only, fake bank/checks.');
} else {
  await writeLiveBenchmark(process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../../../docs/evidence/inbox-benchmark/receipt.json', import.meta.url)),
    process.env.BENCHMARK_SOURCE_SHA ?? execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim());
}
