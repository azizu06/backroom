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

/**
 * The world outside the windows (scene mounts WorldShell and Outdoors). Kept apart from PALETTE so the
 * indoor roles stay pastel; these are the only outdoor colours, never literals in scene code.
 */
export const OUTDOOR = {
  skyTop: "#6FA8DC",
  skyHorizon: "#CFE8F3",
  rainSkyTop: "#91A9BD",
  rainSkyHorizon: "#D0DEE5",
  rain: "#C5D9E8",
  sun: "#FFE9A8",
  sunHalo: "#FFF4CF",
  sunWarm: "#FFE0A0",
  skyTint: "#FFFDF8",
  skyTintWarm: "#F7F3EE",
  cloud: "#F4F5EF",
  bird: "#667990",
  grass: "#9CCB7E",
  grassDark: "#7FB466",
  foliage: "#5E9E5A",
  foliageLight: "#86BF6A",
  bush: "#6FAE5E",
  trunk: "#8A6A4F",
  hills: "#8FB9A0",
  hillsFar: "#A9C8C2",
  path: "#E4D6BF",
  glass: "#BFE3F0",
  windowFrame: "#F2EADC",
  ceilingPanel: "#FFF8DD",
  counter: "#E9DDCB",
  fridge: "#E8EEF0",
  sofa: "#B9A6D9",
  screen: "#2E3A52",
} as const;

export type OutdoorName = keyof typeof OUTDOOR;
