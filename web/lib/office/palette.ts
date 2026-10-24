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
} as const;

export type RoleName = keyof typeof ROLES;
