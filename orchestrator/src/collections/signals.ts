import type { CrsEvidence } from '../integrations/crs';
import type { HealthResult } from './types';

export interface SignalRow {
  id: string;
  source: 'crs_sandbox' | 'crs_fixture' | 'apify';
  type: string;
  subjectRef: string;
  value: number | boolean | string;
  observedAt: string;
  confidence: number;
  label: string;
  evidenceRef?: string;
}
export interface SignalSink { recordSignal(row: SignalRow): Promise<void> }

/** Fixed key order keeps retries identical regardless of the caller's property order. */
export function signalPayload(row: SignalRow): string {
  const { id, source, type, subjectRef, value, observedAt, confidence, label, evidenceRef } = row;
  return JSON.stringify({ id, source, type, subjectRef, value, observedAt, confidence, label, evidenceRef });
}

function validRow(row: SignalRow): boolean {
  return !!row.id && row.id.length <= 200 && !!row.source && !!row.type;
}

export function signalsFromCrs(subjectRef: string, evidence: CrsEvidence): SignalRow[] {
  const fields = [
    ['bankruptcies', 'crs_bankruptcies'], ['judgments', 'crs_judgments'],
    ['liens', 'crs_liens'], ['fraudRiskScore', 'crs_fraud_risk_score'],
  ] as const;
  const rows: SignalRow[] = [];
  for (const [field, type] of fields) {
    const value = evidence.summary[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const row: SignalRow = {
      id: JSON.stringify([evidence.source, type, subjectRef, evidence.testIdentityId, evidence.checkedAt]),
      source: evidence.source, type, subjectRef, value, observedAt: evidence.checkedAt, confidence: 1,
      // Cached evidence is the same observation; its display-only suffix must not change the immutable row.
      label: evidence.source === 'crs_fixture' ? `FAKE: CRS fixture, test identity #${evidence.testIdentityId}` : `SANDBOX: test identity #${evidence.testIdentityId}`,
      evidenceRef: evidence.responseHash,
    };
    if (validRow(row)) rows.push(row);
  }
  return rows;
}

export function signalsFromHealth(subjectRef: string, result: HealthResult, label: string): SignalRow[] {
  const rows: SignalRow[] = [];
  for (const signal of result.signals) {
    if (!signal.type) continue;
    const type = `apify_${signal.type}`;
    const row: SignalRow = {
      id: JSON.stringify(['apify', type, subjectRef, signal.observedAt]),
      source: 'apify', type, subjectRef, value: signal.value, observedAt: signal.observedAt, confidence: 1, label,
      ...(result.apifyRunId === undefined ? {} : { evidenceRef: result.apifyRunId }),
    };
    if (validRow(row)) rows.push(row);
  }
  return rows;
}

export async function recordSignals(sink: SignalSink, rows: readonly SignalRow[]): Promise<{ recorded: number; failed: number }> {
  const counts = { recorded: 0, failed: 0 };
  for (const row of rows) {
    try { await sink.recordSignal(row); counts.recorded++; }
    catch { counts.failed++; }
  }
  return counts;
}
