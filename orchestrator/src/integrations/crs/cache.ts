import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

// One write queue per file across every instance in this process, so read-modify-write never drops rows.
const queues = new Map<string, Promise<unknown>>();

/**
 * Survives a demo restart. Holds only projected evidence (summary + response hash), the same data the
 * audit log stores. Written atomically with owner-only permissions; unreadable or foreign rows are ignored.
 * Separate processes sharing one file never corrupt it (unique temp file + rename), but the last writer's
 * rows win; give each process its own file if both need complete caches.
 */
export class FileCrsEvidenceCache implements CrsEvidenceCache {
  private readonly path: string;
  constructor(path: string) { this.path = resolve(path); }

  async #read(): Promise<Record<string, CrsEvidence>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([, row]) => isEvidence(row))) as Record<string, CrsEvidence>;
    } catch { return {}; }
  }

  async get(key: string) { return (await this.#read())[key]; }

  set(key: string, evidence: CrsEvidence): Promise<void> {
    const next = (queues.get(this.path) ?? Promise.resolve()).then(async () => {
      const rows = await this.#read();
      rows[key] = { ...evidence, cached: undefined } as CrsEvidence;
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
        await rename(temp, this.path);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    queues.set(this.path, next.catch(() => undefined));
    return next;
  }
}
