import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { evaluatorSourceHash, inputFileSha256 } from './provenance';

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
