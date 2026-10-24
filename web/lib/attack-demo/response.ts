export type AttackMode = 'mock' | 'live';
type AttackQuote = string | { sentenceId: string; text: string };
export type AttackDecision = {
  kind: string; ruleIds: string[]; reason: string; policyVersion: string | number; quote?: AttackQuote; toHuman?: string;
};
export type AttackStep = { role: string; execution: 'code' | 'mock' | 'live'; observed: string; proposed: string; decision?: string | AttackDecision };
type EvidenceValue = string | number | boolean | null | EvidenceValue[] | { [key: string]: EvidenceValue };
export type AttackResult = {
  mode: AttackMode; source: 'judge'; caseId: string; trust: 'untrusted_data'; environment: 'isolated_synthetic_company'; senderDomain: string;
  steps: AttackStep[]; skippedRoles: string[]; decision: AttackDecision; rules: { id: string; reason: string }[];
  moneyMoved: boolean; paymentAttempts: number; modelEvidence?: Record<string, EvidenceValue>; liveBlocked?: boolean;
};
export type AttackPreset = { id: string; title: string; senderDomain: string; text: string };
export type AttackPresets = { presets: AttackPreset[]; defaultMode: 'mock'; liveBlocked?: boolean };

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 16_000): value is string {
  return typeof value === 'string' && value.length <= max;
}
export function presetId(value: unknown): value is string {
  return text(value, 256) && !!value.trim();
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(item => text(item, 256));
}
function quote(value: unknown): AttackQuote | null {
  if (text(value)) return value;
  return record(value) && text(value.sentenceId, 256) && text(value.text) ? { sentenceId: value.sentenceId, text: value.text } : null;
}
function decision(value: unknown): AttackDecision | null {
  if (!record(value) || !text(value.kind, 64) || !value.kind.trim() || !text(value.reason) || !strings(value.ruleIds)
    || !(text(value.policyVersion, 128) || (typeof value.policyVersion === 'number' && Number.isFinite(value.policyVersion)))
    || (value.toHuman !== undefined && !text(value.toHuman))) return null;
  const parsedQuote = value.quote === undefined ? undefined : quote(value.quote);
  if (parsedQuote === null) return null;
  return { kind: value.kind, ruleIds: [...value.ruleIds], reason: value.reason, policyVersion: value.policyVersion,
    ...(parsedQuote !== undefined ? { quote: parsedQuote } : {}), ...(value.toHuman !== undefined ? { toHuman: value.toHuman } : {}) };
}
/** Model evidence has service-defined fields; retain bounded JSON data for text-only display. */
function evidence(value: unknown, depth = 0): value is EvidenceValue {
  if (value === null || typeof value === 'boolean' || text(value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 6) return false;
  if (Array.isArray(value)) return value.length <= 64 && value.every(item => evidence(item, depth + 1));
  return record(value) && Object.keys(value).length <= 64 && Object.entries(value).every(([key, item]) => text(key, 256) && evidence(item, depth + 1));
}

/** Rebuild only the display contract. Unknown envelope, step, decision and rule fields are stripped. */
export function parseAttackResult(value: unknown): AttackResult | null {
  if (!record(value) || (value.mode !== 'mock' && value.mode !== 'live') || value.source !== 'judge'
    || !text(value.caseId, 256) || !value.caseId.trim() || value.trust !== 'untrusted_data' || value.environment !== 'isolated_synthetic_company'
    || !text(value.senderDomain, 256) || !strings(value.skippedRoles)
    || typeof value.moneyMoved !== 'boolean' || !Number.isSafeInteger(value.paymentAttempts) || (value.paymentAttempts as number) < 0
    || !Array.isArray(value.steps) || value.steps.length > 32 || !Array.isArray(value.rules) || value.rules.length > 64) return null;
  const final = decision(value.decision);
  if (!final) return null;
  const steps: AttackStep[] = [];
  for (const step of value.steps) {
    if (!record(step) || !text(step.role, 128) || !step.role.trim() || !['code', 'mock', 'live'].includes(step.execution as string)
      || !text(step.observed) || !text(step.proposed)) return null;
    const parsed: AttackStep = { role: step.role, execution: step.execution as AttackStep['execution'], observed: step.observed, proposed: step.proposed };
    if (step.decision !== undefined) {
      const next = text(step.decision) ? step.decision : decision(step.decision);
      if (next === null) return null;
      parsed.decision = next;
    }
    steps.push(parsed);
  }
  const rules: AttackResult['rules'] = [];
  for (const rule of value.rules) {
    if (!record(rule) || !text(rule.id, 256) || !rule.id.trim() || !text(rule.reason)) return null;
    rules.push({ id: rule.id, reason: rule.reason });
  }
  if (value.modelEvidence !== undefined && (!record(value.modelEvidence) || !evidence(value.modelEvidence))) return null;
  return {
    mode: value.mode, source: 'judge', caseId: value.caseId, trust: value.trust, environment: value.environment, senderDomain: value.senderDomain,
    steps, skippedRoles: [...value.skippedRoles], decision: final, rules,
    moneyMoved: value.moneyMoved, paymentAttempts: value.paymentAttempts as number,
    ...(value.modelEvidence !== undefined ? { modelEvidence: JSON.parse(JSON.stringify(value.modelEvidence)) as Record<string, EvidenceValue> } : {}),
    ...(typeof value.liveBlocked === 'boolean' ? { liveBlocked: value.liveBlocked } : {}),
  };
}

/** Accept the service envelope; skip malformed presets without inventing any. IDs are opaque data. */
export function parseAttackPresets(value: unknown): AttackPresets | null {
  if (!record(value) || value.defaultMode !== 'mock' || !Array.isArray(value.presets) || value.presets.length > 32) return null;
  const presets: AttackPreset[] = [];
  for (const row of value.presets) {
    if (!record(row) || !presetId(row.id) || !text(row.title, 256) || !row.title.trim() || !text(row.senderDomain, 256)
      || !text(row.text, 2000) || !row.text.trim() || presets.some(preset => preset.id === row.id)) continue;
    presets.push({ id: row.id, title: row.title, senderDomain: row.senderDomain, text: row.text });
  }
  if (value.presets.length && !presets.length) return null;
  return { presets, defaultMode: 'mock', ...(typeof value.liveBlocked === 'boolean' ? { liveBlocked: value.liveBlocked } : {}) };
}
