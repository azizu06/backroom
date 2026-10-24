import northfield from "./northfield.json";
import type { Badge, CollectionEnvelope, CollectionLimits, Policy } from "./types";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
/** Northfield bank-change risk threshold (NF-028); models cannot override it. */
export const CRS_FRAUD_RISK_THRESHOLD = 70;
export const DEFAULT_POLICY: Policy = deepFreeze(northfield);

/** Pure save: use the previous persisted version, never a caller-supplied draft version. */
export function savePolicy(previous: Policy, draft: Omit<Policy, "policyVersion">): Policy {
  const next = { ...draft, policyVersion: previous.policyVersion + 1 };
  if (!validPolicy(previous) || !validPolicy(next)) throw new Error("Invalid policy or exhausted policyVersion");
  return JSON.parse(JSON.stringify(next)) as Policy;
}
/** The envelope is data for call planning; it never authorizes a side effect. */
export function computeEnvelope(policy: Policy = DEFAULT_POLICY, activeSignals: readonly string[] = []): CollectionEnvelope {
  if (!validPolicy(policy)) throw new Error("Invalid policy");
  const envelope = { ...policy.badges.collections.limits, payInFull: true as const };
  for (const name of activeSignals) {
    const adjustment = Object.hasOwn(policy.signalAdjustments, name) ? policy.signalAdjustments[name] : undefined;
    if (!adjustment) continue;
    envelope.maxInstallments = Math.min(envelope.maxInstallments, adjustment.maxInstallments ?? envelope.maxInstallments);
    envelope.minFirstPct = Math.max(envelope.minFirstPct, adjustment.minFirstPct ?? envelope.minFirstPct);
    envelope.maxPlanDays = Math.min(envelope.maxPlanDays, adjustment.maxPlanDays ?? envelope.maxPlanDays);
    envelope.maxDiscountPct = Math.min(envelope.maxDiscountPct, adjustment.maxDiscountPct ?? envelope.maxDiscountPct);
    envelope.feesWaivable = envelope.feesWaivable && (adjustment.feesWaivable ?? true);
  }
  return envelope;
}

function partialLimits(limits: Partial<CollectionLimits>): boolean {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return false;
  return (limits.maxInstallments === undefined || (Number.isSafeInteger(limits.maxInstallments) && limits.maxInstallments >= 1))
    && (limits.maxPlanDays === undefined || (Number.isSafeInteger(limits.maxPlanDays) && limits.maxPlanDays >= 0))
    && (limits.minFirstPct === undefined || percent(limits.minFirstPct))
    && (limits.maxDiscountPct === undefined || percent(limits.maxDiscountPct))
    && (limits.feesWaivable === undefined || typeof limits.feesWaivable === "boolean");
}
function percent(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 100; }
export function validPolicy(policy: Policy): boolean {
  const limits = policy?.badges?.collections?.limits;
  const required: (keyof CollectionLimits)[] = ["maxInstallments", "minFirstPct", "maxPlanDays", "feesWaivable", "maxDiscountPct"];
  if (!limits || !required.every(key => Object.hasOwn(limits, key) && limits[key] !== undefined) || !partialLimits(limits)) return false;
  const ap = policy.badges.payables, window = policy.callWindow;
  return Number.isSafeInteger(policy.policyVersion) && policy.policyVersion >= 1
    && typeof policy.owner === "string" && policy.owner.trim().length > 0
    && typeof policy.toHuman === "string" && policy.toHuman.trim().length > 0
    && !!ap && Number.isSafeInteger(ap.maxPaymentCents) && ap.maxPaymentCents > 0 && ap.account === "operating"
    && !!window && Array.isArray(window.weekdays) && window.weekdays.length > 0
    && window.weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 5)
    && Number.isFinite(window.startHour) && Number.isFinite(window.endHour)
    && window.startHour >= 9 && window.endHour <= 18 && window.startHour < window.endHour
    && (["collections", "payables", "vendor_onboarding"] as Badge[]).every(badge => {
      const seat = policy.badges[badge], ceiling = DEFAULT_POLICY.badges[badge];
      return !!seat && Array.isArray(seat.actions) && seat.actions.every(action => ceiling.actions.includes(action))
        && Array.isArray(seat.rooms) && seat.rooms.every(room => ceiling.rooms.includes(room));
    })
    && !!policy.signalAdjustments && typeof policy.signalAdjustments === "object" && !Array.isArray(policy.signalAdjustments)
    && Object.values(policy.signalAdjustments).every(partialLimits);
}
