import { expect, it } from 'vitest';
import { evaluatorSourceHash } from './provenance';

it('publishes the same evaluator provenance from a CRLF checkout and an LF Git blob', () => {
  const committed = Buffer.from('export const answer = 42;\n// café\n', 'utf8');
  const windowsCheckout = Buffer.from('export const answer = 42;\r\n// café\r\n', 'utf8');
  expect(evaluatorSourceHash(windowsCheckout)).toBe(evaluatorSourceHash(committed));
  expect(evaluatorSourceHash('export const answer = 43;\n// café\n')).not.toBe(evaluatorSourceHash(committed));
});
