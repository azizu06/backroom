import { createHash } from 'node:crypto';

export function evaluatorSourceHash(source: Buffer | string): string {
  // Git stores these UTF-8 source files with LF, even in a CRLF Windows checkout.
  // Only evaluator text is canonicalized; frozen fixtures keep byte-exact hashes.
  return createHash('sha256').update(source.toString().replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
