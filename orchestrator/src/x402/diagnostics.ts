/** Machine reason codes only. Never return raw provider errors/bodies or signed payloads. */
export function facilitatorReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const code = value.split(':', 1)[0]!;
  return /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : 'redacted_provider_error';
}
export interface FacilitatorDiagnostic { stage: 'verify' | 'settle'; success: boolean; reason?: string }
