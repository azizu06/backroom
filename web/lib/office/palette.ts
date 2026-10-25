/** Cozy pastel palette for the office. One source of truth: scene code reads colours from here, never from literals. Anchor: the light-aqua bear logo. */
export const PALETTE = {
  aqua: "#9EF2FB",
  cream: "#FFF7EC",
  peach: "#F6D3B8",
  butter: "#FFF0B3",
  blush: "#FFC9D9",
  lavender: "#D9CCFF",
  mint: "#CDF2DC",
  navy: "#4A5A7A",
  slate: "#7C88A6",
  coral: "#E8727A",
} as const;

export type PaletteName = keyof typeof PALETTE;

/** What each part of the office uses. Change a role here and every room follows. */
export const ROLES = {
  wall: PALETTE.cream,
  ceiling: PALETTE.cream,
  floor: PALETTE.peach,
  rug: PALETTE.blush,
  desk: PALETTE.peach,
  partition: PALETTE.lavender,
  plant: PALETTE.mint,
  lampLight: PALETTE.butter,
  fillLight: PALETTE.aqua,
  screenGlow: PALETTE.aqua,
  frame: PALETTE.navy,
  text: PALETTE.navy,
  shadow: PALETTE.slate,
  deny: PALETTE.coral,
  background: PALETTE.cream,
  roomPad: PALETTE.cream,
  aisle: PALETTE.blush,
  statusOk: PALETTE.mint,
  statusWarn: PALETTE.butter,
} as const;

export type RoleName = keyof typeof ROLES;

/** AJ's cozy accents (branch 271-cozy-office-ui), for office chrome highlights only; the 3D world keeps PALETTE and ROLES. */
export const ACCENTS = {
  cyan: "#A9F6FF",
  yellow: "#FFF3A6",
  navy: "#19213B",
} as const;

/**
 * Office chrome tokens per theme, using AJ's names exactly. app/office/office-tokens.css mirrors these;
 * lib/office/overlay-contrast.test.ts checks the mirror and every text/plate pair in both themes.
 */
export const CHROME = {
  light: {
    ink: ACCENTS.navy,
    "ink-soft": "#4B5577",
    paper: "#FFFDF4",
    line: "#D6F0F5",
    "pastel-aqua": ACCENTS.cyan,
    "pastel-yellow": ACCENTS.yellow,
    focus: ACCENTS.navy,
  },
  dark: {
    ink: "#FFF8DC",
    "ink-soft": "#C7CEE6",
    paper: "#222C4E",
    line: "#2E3A63",
    "pastel-aqua": ACCENTS.cyan,
    "pastel-yellow": ACCENTS.yellow,
    focus: "#FFF8DC",
  },
} as const;

export type OfficeTheme = keyof typeof CHROME;
