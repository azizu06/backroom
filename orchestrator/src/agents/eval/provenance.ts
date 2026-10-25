import { createHash } from 'node:crypto';

export function evaluatorSourceHash(source: Buffer | string): string {
  return canonicalTextSha256(source);
}

/** Git's LF text representation, independent of checkout line endings. Use only for
 * explicitly identified text sources/receipts; frozen fixtures remain byte-exact. */
export function canonicalTextSha256(source: Buffer | string): string {
  return createHash('sha256').update(source.toString().replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** SHA-256 of raw file bytes. Same normalization as scoreboard input hashes: none. */
export function inputFileSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
