import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CrsEvidence, CrsEvidenceCache } from './index';

/** Process-local outage cache. */
export class MemoryCrsEvidenceCache implements CrsEvidenceCache {
  readonly #rows = new Map<string, CrsEvidence>();
  async get(key: string) { const row = this.#rows.get(key); return row && structuredClone(row); }
  async set(key: string, evidence: CrsEvidence) { this.#rows.set(key, structuredClone(evidence)); }
}

const isEvidence = (value: unknown): value is CrsEvidence => {
  const row = value as CrsEvidence;
  return !!row && row.source === 'crs_sandbox' && typeof row.product === 'string' && Number.isSafeInteger(row.testIdentityId) &&
    typeof row.label === 'string' && typeof row.checkedAt === 'string' && /^[a-f0-9]{64}$/.test(row.responseHash) &&
    !!row.summary && typeof row.summary === 'object';
};

/**
 * Survives a demo restart. Holds only projected evidence (summary + response hash), the same data the
 * audit log stores. Written atomically with owner-only permissions; unreadable or foreign rows are ignored.
 */
export class FileCrsEvidenceCache implements CrsEvidenceCache {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}

  async #read(): Promise<Record<string, CrsEvidence>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, row]) => isEvidence(row))) as Record<string, CrsEvidence>;
    } catch { return {}; }
  }

  async get(key: string) { return (await this.#read())[key]; }

  set(key: string, evidence: CrsEvidence): Promise<void> {
    // Serialize writers so concurrent product calls cannot drop each other's rows.
    const next = this.#queue.then(async () => {
      const rows = await this.#read();
      rows[key] = { ...evidence, cached: undefined } as CrsEvidence;
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, this.path);
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }
}
