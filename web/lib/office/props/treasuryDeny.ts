import { OFFICE_ANCHORS, isAnchorId, matchingDenial, visibleRooms, type OfficeSnapshot } from '../state';
import type { OfficePropInteraction } from './interact';
import { ROLES } from '../palette';

/** How long the Treasury door "DENY moment" plays before the door settles. */
export const DENY_MOMENT_MS = 4000;
export const DENY_FALLBACK_COLOR: string = ROLES.shadow;
/** Floor (x, z) of the Treasury doorway; the aisle is on its -z side, the vault room on its +z side. */
export const TREASURY_DOOR: readonly [x: number, z: number] = [5, 1.15];
/** Where the denied agent's echo stands on the aisle side of the door. */
export const ECHO_START: readonly [x: number, z: number] = [5, 0.55];
/** How far the echo walks back toward the aisle (decreasing z). */
export const ECHO_WALK = 1.2;
export const ECHO_OPACITY = 0.55;
const TURN_START = 0.35, WALK_START = 0.55, PULSE_END = 0.7, PULSES = 3;
const SIGN_FADE_IN = 0.06, SIGN_FADE_OUT = 0.15;

/** What the server's DENY audit row says about the latest Treasury refusal. Display data only. */
export interface DenyReceipt {
  auditId: string;
  agentId: string;
  agentName: string;
  color: string;
  ruleIds: readonly string[];
  rule: string;
  signText: string;
}

/**
 * Heading uses the Avatar convention in scene.tsx: it is the group's rotation.y and equals
 * WalkMotion.heading = atan2(dx, dz), so 0 faces +z (toward the Treasury door from the aisle)
 * and PI faces -z (back toward the aisle).
 */
export interface DenyEcho { x: number; z: number; heading: number; opacity: number }
export interface DenyPose {
  /** 0..1 door ring intensity. */
  pulse: number;
  /** 0..1 hanging sign opacity. */
  signOpacity: number;
  echo: DenyEcho;
}
export interface DenyMoment extends DenyReceipt, DenyPose { active: boolean }

export function denyReceipt(snapshot: OfficeSnapshot): DenyReceipt | null {
  const denial = matchingDenial(snapshot, 'treasury');
  if (!denial) return null;
  const row = snapshot.audit.findLast(entry => entry.id === denial.auditId && entry.decision === 'DENY');
  const agent = snapshot.agents.find(entry => entry.id === denial.agentId);
  const seat = agent?.seatId ?? row?.seatId;
  const ruleIds = row?.ruleIds ?? [];
  const rule = ruleIds[0] ?? 'DENIED';
  return {
    auditId: denial.auditId, agentId: denial.agentId, agentName: agent?.name ?? denial.agentId,
    color: isAnchorId(seat) ? OFFICE_ANCHORS[seat].color : DENY_FALLBACK_COLOR,
    ruleIds, rule, signText: `DENIED · ${rule}`,
  };
}

export function createDenyPose(): DenyPose {
  return { pulse: 0, signOpacity: 0, echo: { x: ECHO_START[0], z: ECHO_START[1], heading: 0, opacity: 0 } };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => { const p = clamp01(value); return p * p * (3 - 2 * p); };

/**
 * Pose of the moment at `ageMs` (clamped at 0, like doorHighlight). Writes into `out` so the
 * scene can reuse one object per frame. Reduced motion: constant ring, sign on then off, and the
 * echo already turned away at its end pose with no turn or walk.
 */
export function denyPose(ageMs: number, reduced: boolean, out: DenyPose = createDenyPose()): DenyPose {
  const age = Math.max(0, ageMs);
  const active = age < DENY_MOMENT_MS;
  const t = clamp01(age / DENY_MOMENT_MS);
  const echo = out.echo;
  echo.x = ECHO_START[0];
  if (!active) {
    out.pulse = 0; out.signOpacity = 0; echo.opacity = 0;
    echo.z = ECHO_START[1] - ECHO_WALK; echo.heading = Math.PI;
    return out;
  }
  if (reduced) {
    out.pulse = 1; out.signOpacity = 1;
    echo.z = ECHO_START[1] - ECHO_WALK; echo.heading = Math.PI; echo.opacity = ECHO_OPACITY;
    return out;
  }
  out.pulse = t < PULSE_END
    ? 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(2 * Math.PI * PULSES * t / PULSE_END))
    : clamp01((1 - t) / (1 - PULSE_END));
  out.signOpacity = clamp01(Math.min(t / SIGN_FADE_IN, (1 - t) / SIGN_FADE_OUT));
  if (t < TURN_START) {
    echo.z = ECHO_START[1]; echo.heading = 0; echo.opacity = ECHO_OPACITY;
  } else if (t < WALK_START) {
    echo.z = ECHO_START[1]; echo.heading = Math.PI * smooth((t - TURN_START) / (WALK_START - TURN_START)); echo.opacity = ECHO_OPACITY;
  } else {
    const p = (t - WALK_START) / (1 - WALK_START);
    echo.z = ECHO_START[1] - ECHO_WALK * smooth(p); echo.heading = Math.PI; echo.opacity = ECHO_OPACITY * (1 - p);
  }
  return out;
}

/** Null without a matching server denial for Treasury or once the moment is over. */
export function denyMoment(snapshot: OfficeSnapshot, now: number, reduced: boolean): DenyMoment | null {
  const denial = matchingDenial(snapshot, 'treasury');
  if (!denial) return null;
  const age = Math.max(0, now - denial.at);
  if (age >= DENY_MOMENT_MS) return null;
  const receipt = denyReceipt(snapshot);
  if (!receipt) return null;
  return { ...receipt, ...denyPose(age, reduced), active: true };
}

/** The Treasury doorway on the aisle; shows the server's latest DENY receipt for it, if any. */
export const TREASURY_DOOR_INTERACTION: OfficePropInteraction = {
  id: 'treasury-door',
  prompt: 'Inspect Treasury door',
  position: [5, 0.6],
  radius: 1.2,
  visible: snapshot => visibleRooms(snapshot).includes('treasury'),
  panel(snapshot) {
    const receipt = denyReceipt(snapshot);
    return {
      title: 'Treasury door',
      rows: [
        { label: 'Status', value: 'Locked · Dana only' },
        ...receipt ? [
          { label: 'Last attempt', value: receipt.agentName },
          { label: 'Decision', value: 'DENY' },
          { label: 'Rules', value: receipt.ruleIds.join(', ') || 'DENIED' },
          { label: 'Audit', value: receipt.auditId },
        ] : [],
      ],
    };
  },
};
