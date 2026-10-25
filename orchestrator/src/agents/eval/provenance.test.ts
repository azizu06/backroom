import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { canonicalTextSha256, evaluatorSourceHash, inputFileSha256 } from './provenance';
import { CRS_RECEIPT_PATH, replayRecordedCrsCoverage } from './crs-availability';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pdfExtractionPath = 'docs/eval/pdf-extraction.json';

it('publishes the same evaluator provenance from a CRLF checkout and an LF Git blob', () => {
  const committed = Buffer.from('export const answer = 42;\n// café\n', 'utf8');
  const windowsCheckout = Buffer.from('export const answer = 42;\r\n// café\r\n', 'utf8');
  expect(evaluatorSourceHash(windowsCheckout)).toBe(evaluatorSourceHash(committed));
  expect(evaluatorSourceHash('export const answer = 43;\n// café\n')).not.toBe(evaluatorSourceHash(committed));
});

it('records the committed PDF extraction byte hash in scoreboard provenance inputs', () => {
  const scoreboard = JSON.parse(readFileSync(join(root, 'docs/eval/scoreboard.json'), 'utf8'));
  expect(scoreboard.provenance.inputs[pdfExtractionPath]).toBe(inputFileSha256(readFileSync(join(root, pdfExtractionPath))));
});

it('records the same CRS receipt hash in both report locations across LF and CRLF checkouts', async () => {
  const receipt = readFileSync(join(root, CRS_RECEIPT_PATH), 'utf8');
  const lf = receipt.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  const expected = inputFileSha256(Buffer.from(lf));
  expect(canonicalTextSha256(crlf)).toBe(expected);
  expect(inputFileSha256(Buffer.from(crlf))).not.toBe(expected);
  const scoreboard = JSON.parse(readFileSync(join(root, 'docs/eval/scoreboard.json'), 'utf8'));
  expect(scoreboard.provenance.inputs[CRS_RECEIPT_PATH]).toBe(expected);
  expect(scoreboard.crsRecordedCoverage.receiptSha256).toBe(expected);
  expect((await replayRecordedCrsCoverage()).receiptSha256).toBe(expected);
});
