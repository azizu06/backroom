/**
 * Agent bears (the Cal Hacks mascot): proportions, palette and idle/limb motion for the shared
 * Bear avatar. Pure and three-free so the numbers are testable and stay out of the initial bundle.
 */
import { legSwing } from './a11y';

export const CAL_BLUE = '#003262';
export const CAL_GOLD = '#fdb515';
export const BEAR_FALLBACK_ACCENT = '#9aa38f';
const CREAM = '#f3dfb9';
const NOSE = '#1d1a17';

type Vec3 = readonly [x: number, y: number, z: number];
export interface BearBox { readonly at: Vec3; readonly size: Vec3 }
export interface BearBall { readonly at: Vec3; readonly radius: number }

/**
 * Metres, bear facing +z (the WalkMotion heading convention). Legs hang from `hip`, arms from
 * `shoulder` and head parts are relative to `neck`, so swinging or tilting a pivot moves its parts.
 */
export const BEAR = {
  hip: 0.56,
  leg: { x: 0.12, part: { at: [0, -0.27, 0], size: [0.2, 0.54, 0.24] } },
  foot: { at: [0, -0.5, 0.05], size: [0.21, 0.08, 0.3] },
  torso: { at: [0, 0.84, 0], size: [0.48, 0.58, 0.32] },
  belly: { at: [0, 0.79, 0.16], size: [0.3, 0.34, 0.03] },
  scarf: { at: [0, 1.09, 0], size: [0.5, 0.09, 0.36] },
  scarfTail: { at: [0.13, 0.96, 0.18], size: [0.09, 0.2, 0.03] },
  badge: { at: [-0.12, 0.97, 0.164], size: [0.13, 0.13, 0.01] },
  shoulder: { x: 0.31, y: 1.04 },
  arm: { at: [0, -0.19, 0], size: [0.14, 0.42, 0.17] },
  paw: { at: [0, -0.4, 0], radius: 0.085 },
  neck: 1.13,
  head: { at: [0, 0.19, 0], size: [0.42, 0.36, 0.36] },
  ear: { at: [0.15, 0.39, -0.03], radius: 0.085 },
  innerEar: { at: [0.15, 0.39, 0.02], radius: 0.05 },
  muzzle: { at: [0, 0.12, 0.2], size: [0.2, 0.13, 0.08] },
  nose: { at: [0, 0.17, 0.245], size: [0.08, 0.05, 0.025] },
  eye: { at: [0.095, 0.25, 0.182], size: [0.05, 0.05, 0.01] },
} as const satisfies Record<string, unknown>;

/** Arm poses (radians): `pitch` swings the paw forward (negative is forward), `tuck` pulls it inward. */
export interface ArmPose { readonly pitch: number; readonly tuck: number }
/** Both paws held out in front, under the folder the handoff plan floats at chest height. */
export const BEAR_CARRY_FRONT: ArmPose = { pitch: -1, tuck: 0.24 };
/** The escalation folder hangs from the right paw, held a little forward. */
export const BEAR_CARRY_PAW: ArmPose = { pitch: -0.18, tuck: 0 };

/** Paw centre in bear space for an arm on `side` (-1 left, 1 right) in `pose` (Euler XYZ, as three applies it). */
export function pawPosition(side: -1 | 1, pose: ArmPose): Vec3 {
  const length = -BEAR.paw.at[1], phi = -side * pose.tuck, theta = pose.pitch;
  const x = length * Math.sin(phi), y = -length * Math.cos(phi);
  return [side * BEAR.shoulder.x + x, BEAR.shoulder.y + y * Math.cos(theta), y * Math.sin(theta)];
}

/** Top of the ears; name tags project at 1.95 m. */
export const BEAR_HEIGHT = BEAR.neck + BEAR.ear.at[1] + BEAR.ear.radius;
/** Widest point from the centre line (shoulder plus arm half-width). */
export const BEAR_HALF_WIDTH = BEAR.shoulder.x + BEAR.arm.size[0] / 2;

/** Arms swing opposite the same-side leg, a little less far. */
export function armSwing(distance: number, i: number, moving: boolean, reduced: boolean): number {
  return reduced || !moving ? 0 : legSwing(distance, i + 1, moving, reduced) * 0.8;
}

/** Stable per-agent phase in [0, 2π) so the bears do not breathe in lockstep. */
export function bearPhase(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 3600) / 3600 * Math.PI * 2;
}

export interface BearIdle { readonly breath: number; readonly tilt: number; readonly nod: number }
const STILL: BearIdle = { breath: 0, tilt: 0, nod: 0 };
/**
 * Idle pose at `seconds` of scene clock. Only applied on frames something else requested; nothing
 * under reduced motion. `breath` is a chest scale offset, `tilt`/`nod` are head radians.
 */
export function bearIdle(seconds: number, phase: number, reduced: boolean): BearIdle {
  if (reduced || !Number.isFinite(seconds)) return STILL;
  const t = seconds + phase;
  return { breath: Math.sin(t * 2.1) * 0.018, tilt: Math.sin(t * 0.7) * 0.07, nod: Math.sin(t * 1.3 + 1) * 0.03 };
}

type Rgb = readonly [r: number, g: number, b: number];
function parseHex(color: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1]!.length === 3 ? [...match[1]!].map(c => c + c).join('') : match[1]!;
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}
function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function toHsl([r, g, b]: Rgb): [h: number, s: number, l: number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG relative luminance of a hex colour (0 black, 1 white). */
export function luminance(color: string): number {
  const rgb = parseHex(color) ?? [0, 0, 0];
  const [r, g, b] = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two hex colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface BearPalette {
  /** Darker tone of the role accent, same hue. */
  readonly fur: string;
  /** Muzzle, inner ears, belly and paw pads: the accent lifted toward cream. */
  readonly muzzle: string;
  readonly nose: string;
  readonly scarf: string;
  readonly badge: string;
}
const palettes = new Map<string, BearPalette>();
/** Deterministic palette for a role accent; unparseable colours fall back to the neutral seat accent. */
export function bearPalette(accent: string): BearPalette {
  const cached = palettes.get(accent);
  if (cached) return cached;
  const rgb = parseHex(accent) ?? parseHex(BEAR_FALLBACK_ACCENT)!;
  const [h, s] = toHsl(rgb);
  const palette: BearPalette = {
    fur: toHex(fromHsl(h, Math.min(0.42, Math.max(0.2, s * 1.2)), 0.25)),
    muzzle: toHex(mix(rgb, parseHex(CREAM)!, 0.6)),
    nose: NOSE,
    scarf: CAL_GOLD,
    badge: CAL_BLUE,
  };
  palettes.set(accent, palette);
  return palette;
}
