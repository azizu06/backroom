/**
 * Display wording for recorded evidence labels. Stored labels (audit inputs, signal rows) stay verbatim;
 * pages show this shorter form. An offline record is never shown as a provider check.
 */
const CRS_LABEL = /^(?:CRS sandbox|SANDBOX): test identity #\d+(?: \(cached at (\d\d:\d\d) UTC\))?$/;

/** The HH:MM UTC a cached label carries, if any. */
export function cachedAt(label: string): string | undefined {
  return label.match(/\(cached at (\d\d:\d\d) UTC\)/)?.[1];
}

/** True for a placeholder that ran no provider check. */
export const isOfflineRecord = (label: string) => /^FAKE\b/.test(label);

export function displayProvenance(label: string): string {
  if (isOfflineRecord(label)) return 'Offline record';
  const crs = label.match(CRS_LABEL);
  if (crs) return crs[1] ? `CRS · checked ${crs[1]} UTC` : 'CRS';
  return label;
}

/** "88 / 100 · checked 18:05 UTC" for a recorded CRS fraud score; an offline placeholder has no score. */
export function crsFraudText(fraud: { label: string; score?: number; checkedAt?: string }): string {
  if (isOfflineRecord(fraud.label)) return 'Not checked';
  const checkedAt = fraud.checkedAt ? new Date(fraud.checkedAt) : undefined;
  const at = cachedAt(fraud.label) ?? (checkedAt && Number.isFinite(checkedAt.getTime()) ? checkedAt.toISOString().slice(11, 16) : undefined);
  const parts = [fraud.score !== undefined ? `${fraud.score} / 100` : undefined, at ? `checked ${at} UTC` : undefined].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Score not recorded';
}
